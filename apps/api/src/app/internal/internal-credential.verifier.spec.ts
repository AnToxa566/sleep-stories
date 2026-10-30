import { inspect } from 'node:util';
import { LocalDispatchSecret } from '../providers/job-queue/local-dispatch-secret';
import { createLocalJWKSet, createRemoteJWKSet, errors, exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import type { CryptoKey, JWK, JWTPayload } from 'jose';
import {
  createInternalCredentialVerifier,
  GoogleOidcVerifier,
  googleKeySet,
  InternalCredentialRejectedError,
  InternalCredentialUnavailableError,
  InternalCredentialVerifier,
  LocalSecretVerifier,
  RejectAllVerifier,
} from './internal-credential.verifier';

// Real jose, no mocks: tokens are signed here with a generated RS256 key pair and
// verified against a local key set that holds the public half.
const ISSUER = 'https://accounts.google.com';
const AUDIENCE = 'https://sleep-stories-api-abc123-ew.a.run.app';
const EMAIL = 'tasks@sleep-stories.iam.gserviceaccount.com';
const KID = 'google-key-1';

let privateKey: CryptoKey;
let publicJwk: JWK;
let keys: ReturnType<typeof createLocalJWKSet>;
let verifier: InternalCredentialVerifier;

function baseClaims(overrides: JWTPayload = {}): JWTPayload {
  return { email: EMAIL, email_verified: true, sub: '1234567890', ...overrides };
}

async function sign(
  claims: JWTPayload = baseClaims(),
  {
    key = privateKey,
    alg = 'RS256',
    kid = KID,
    // null omits the claim (undefined would select the default).
    issuer = ISSUER as string | null,
    audience = AUDIENCE as string | null,
    expiresIn = '10m' as string | number | null,
    issuedAt = true,
  } = {},
): Promise<string> {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg, kid });
  if (issuedAt) jwt.setIssuedAt();
  if (issuer !== null) jwt.setIssuer(issuer);
  if (audience !== null) jwt.setAudience(audience);
  if (expiresIn !== null) jwt.setExpirationTime(expiresIn);
  return jwt.sign(key);
}

async function failure(token: string, using: InternalCredentialVerifier = verifier): Promise<unknown> {
  try {
    await using.verify(token);
  } catch (error) {
    return error;
  }
  throw new Error('verify was expected to reject');
}

async function expectRejected(token: string, reason?: string, using?: InternalCredentialVerifier): Promise<void> {
  const error = await failure(token, using);
  expect(error).toBeInstanceOf(InternalCredentialRejectedError);
  if (reason !== undefined) {
    expect((error as InternalCredentialRejectedError).reason).toBe(reason);
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [publicJwk] });
  verifier = new GoogleOidcVerifier({ keys, audience: AUDIENCE, serviceAccountEmail: EMAIL });
});

describe('GoogleOidcVerifier', () => {
  it('accepts a valid Google-shaped token', async () => {
    await expect(verifier.verify(await sign())).resolves.toBeUndefined();
  });

  it('accepts the bare-host spelling of the issuer', async () => {
    await expect(verifier.verify(await sign(baseClaims(), { issuer: 'accounts.google.com' }))).resolves.toBeUndefined();
  });

  it('accepts an audience array that contains the expected audience', async () => {
    const token = await new SignJWT(baseClaims({ aud: ['other', AUDIENCE] }))
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    await expect(verifier.verify(token)).resolves.toBeUndefined();
  });

  it('rejects a wrong issuer and a missing issuer', async () => {
    await expectRejected(
      await sign(baseClaims(), { issuer: 'https://evil.example.com' }),
      'JWTClaimValidationFailed (iss: check_failed)',
    );
    await expectRejected(await sign(baseClaims(), { issuer: null }), 'JWTClaimValidationFailed (iss: missing)');
  });

  it('rejects a wrong audience and a missing audience', async () => {
    await expectRejected(
      await sign(baseClaims(), { audience: 'https://other.example.com' }),
      'JWTClaimValidationFailed (aud: check_failed)',
    );
    await expectRejected(await sign(baseClaims(), { audience: null }), 'JWTClaimValidationFailed (aud: missing)');
  });

  it('rejects another email, an email that differs only in case, and a missing email', async () => {
    await expectRejected(await sign(baseClaims({ email: 'someone@example.com' })), 'ClaimsRejected');
    await expectRejected(await sign(baseClaims({ email: EMAIL.toUpperCase() })), 'ClaimsRejected');
    await expectRejected(await sign(baseClaims({ email: undefined })), 'ClaimsRejected');
  });

  it.each([
    ['false', false],
    ['missing', undefined],
    ['the string "true"', 'true'],
  ])('rejects email_verified that is %s', async (_label, value) => {
    await expectRejected(await sign(baseClaims({ email_verified: value })), 'ClaimsRejected');
  });

  it('rejects an expired token', async () => {
    await expectRejected(await sign(baseClaims(), { expiresIn: Math.floor(Date.now() / 1000) - 60 }), 'JWTExpired');
  });

  it('rejects a token with no exp and a token with no iat', async () => {
    await expectRejected(await sign(baseClaims(), { expiresIn: null }), 'JWTClaimValidationFailed (exp: missing)');
    await expectRejected(await sign(baseClaims(), { issuedAt: false }), 'JWTClaimValidationFailed (iat: missing)');
  });

  it('rejects an unsecured token with alg none', async () => {
    const token = new UnsecuredJWT(baseClaims())
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .encode();
    expect(token.endsWith('.')).toBe(true);
    await expectRejected(token);
  });

  it('rejects an HS256 token whose secret is the public key material (algorithm confusion)', async () => {
    const token = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(JSON.stringify(publicJwk)));
    await expectRejected(token, 'JOSEAlgNotAllowed');
  });

  it('rejects ES256, which is not an allowed algorithm', async () => {
    const ec = await generateKeyPair('ES256', { extractable: true });
    const ecJwk = { ...(await exportJWK(ec.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' };
    const ecVerifier = new GoogleOidcVerifier({
      keys: createLocalJWKSet({ keys: [ecJwk] }),
      audience: AUDIENCE,
      serviceAccountEmail: EMAIL,
    });
    const token = await sign(baseClaims(), { key: ec.privateKey, alg: 'ES256', kid: 'ec-1' });
    await expectRejected(token, 'JOSEAlgNotAllowed', ecVerifier);
  });

  it('rejects a tampered signature and a token signed by another key under the known kid', async () => {
    const [header, payload, signature] = (await sign()).split('.');
    const flipped = `${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`;
    await expectRejected([header, payload, flipped].join('.'), 'JWSSignatureVerificationFailed');
    const other = await generateKeyPair('RS256');
    await expectRejected(await sign(baseClaims(), { key: other.privateKey }), 'JWSSignatureVerificationFailed');
  });

  it('rejects a Supabase-style user token (the issuer and the audience are different)', async () => {
    const token = await sign(
      { sub: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', role: 'authenticated', email: EMAIL, email_verified: true },
      { issuer: 'http://127.0.0.1:54321/auth/v1', audience: 'authenticated' },
    );
    await expectRejected(token);
  });

  it.each(['', 'abc', 'a.b', 'a.b.c', '....', 'a.b.c.d.e'])('rejects the malformed token %j', async (token) => {
    await expectRejected(token);
  });

  describe('when the Google keys cannot be reached', () => {
    const verifierWith = (thrower: () => never) =>
      new GoogleOidcVerifier({ keys: (async () => thrower()) as never, audience: AUDIENCE, serviceAccountEmail: EMAIL });

    it.each([
      ['a JWKS timeout', () => { throw new errors.JWKSTimeout(); }],
      ['a non-200 or unparsable response', () => { throw new errors.JOSEError('Expected 200 OK'); }],
      ['an invalid key set', () => { throw new errors.JWKSInvalid(); }],
      ['a network failure (plain TypeError)', () => { throw new TypeError('fetch failed'); }],
    ])('maps %s to InternalCredentialUnavailableError', async (_label, thrower) => {
      const token = await sign();
      await expect(verifierWith(thrower as () => never).verify(token)).rejects.toBeInstanceOf(
        InternalCredentialUnavailableError,
      );
    });

    it('maps a real failed fetch of a remote key set to InternalCredentialUnavailableError', async () => {
      // Port 1 on loopback refuses the connection immediately; nothing real is contacted.
      const remote = createRemoteJWKSet(new URL('http://127.0.0.1:1/certs'), { timeoutDuration: 2_000 });
      const remoteVerifier = new GoogleOidcVerifier({ keys: remote, audience: AUDIENCE, serviceAccountEmail: EMAIL });
      await expect(remoteVerifier.verify(await sign())).rejects.toBeInstanceOf(InternalCredentialUnavailableError);
    });
  });

  it('never puts claims or the token in an error', async () => {
    const token = await sign(baseClaims({ email: 'leak-check@example.com' }));
    const error = (await failure(token)) as InternalCredentialRejectedError;
    expect(error.reason).toBe('ClaimsRejected');
    expect(JSON.stringify([error.message, error.reason, error.name])).not.toContain('leak-check');
    expect(error.message).not.toContain(token);
  });

  it('googleKeySet builds a key set without any network call', () => {
    expect(typeof googleKeySet()).toBe('function');
  });
});

describe('LocalSecretVerifier', () => {
  const secret = new LocalDispatchSecret();
  const local = new LocalSecretVerifier(secret);

  it('accepts the right secret', async () => {
    await expect(local.verify(secret.value)).resolves.toBeUndefined();
  });

  it('does not reveal the secret it holds when it is inspected', () => {
    const printed = inspect(local, { depth: 10, showHidden: true });
    expect(printed).not.toContain(secret.value);
    expect(printed).toContain('[LocalDispatchSecret]');
  });

  it.each([
    ['a wrong secret of the same length', 'x'.repeat(64)],
    ['an empty string', ''],
    ['a longer string that starts with the secret', `${secret.value}0`],
    ['a shorter prefix of the secret', secret.value.slice(0, 63)],
    ['the secret with a leading space', ` ${secret.value}`],
    ['the secret with a trailing newline', `${secret.value}\n`],
    ['only whitespace', '   '],
  ])('rejects %s', async (_label, presented) => {
    await expectRejected(presented, 'SecretMismatch', local);
  });
});

describe('createInternalCredentialVerifier', () => {
  const secret = new LocalDispatchSecret();
  const build = (mode: 'none' | 'local' | 'cloud-tasks', audience?: string, serviceAccountEmail?: string) =>
    createInternalCredentialVerifier({ mode, audience, serviceAccountEmail, keys, secret });

  it("'local' mode accepts the local secret", async () => {
    await expect(build('local').verify(secret.value)).resolves.toBeUndefined();
  });

  it("'local' mode never accepts a Google token, even a perfect one, and ignores the OIDC settings", async () => {
    const local = build('local', AUDIENCE, EMAIL);
    expect(local).toBeInstanceOf(LocalSecretVerifier);
    await expectRejected(await sign(), 'SecretMismatch', local);
  });

  it("INVARIANT: the local secret is rejected in 'cloud-tasks' mode", async () => {
    const cloud = build('cloud-tasks', AUDIENCE, EMAIL);
    expect(cloud).toBeInstanceOf(GoogleOidcVerifier);
    expect(cloud).not.toBeInstanceOf(LocalSecretVerifier);
    await expectRejected(secret.value, undefined, cloud);
  });

  it("INVARIANT: the local secret is rejected in 'none' mode, configured or not", async () => {
    const configured = build('none', AUDIENCE, EMAIL);
    expect(configured).toBeInstanceOf(GoogleOidcVerifier);
    expect(configured).not.toBeInstanceOf(LocalSecretVerifier);
    await expectRejected(secret.value, undefined, configured);
    await expectRejected(secret.value, undefined, build('none'));
  });

  it("'cloud-tasks' mode accepts a valid Google token", async () => {
    await expect(build('cloud-tasks', AUDIENCE, EMAIL).verify(await sign())).resolves.toBeUndefined();
  });

  it("'cloud-tasks' mode needs both the audience and the service account", () => {
    for (const [audience, email] of [[undefined, EMAIL], [AUDIENCE, undefined], [undefined, undefined], ['', EMAIL], [AUDIENCE, '']]) {
      expect(() => build('cloud-tasks', audience, email)).toThrow(
        'JOB_QUEUE=cloud-tasks needs INTERNAL_OIDC_AUDIENCE and INTERNAL_OIDC_SERVICE_ACCOUNT',
      );
    }
  });

  it("'none' mode without configuration rejects everything, including a perfect Google token", async () => {
    for (const none of [build('none'), build('none', AUDIENCE), build('none', undefined, EMAIL)]) {
      expect(none).toBeInstanceOf(RejectAllVerifier);
      await expectRejected(await sign(), 'NotConfigured', none);
      await expectRejected('anything', 'NotConfigured', none);
    }
  });

  it("'none' mode with both settings verifies Google tokens", async () => {
    await expect(build('none', AUDIENCE, EMAIL).verify(await sign())).resolves.toBeUndefined();
  });
});

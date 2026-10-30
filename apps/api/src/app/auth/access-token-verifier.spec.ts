import { createLocalJWKSet, createRemoteJWKSet, errors, exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import type { CryptoKey, JWK, JWTPayload } from 'jose';
import {
  AccessTokenVerifier,
  AuthUnavailableError,
  JoseAccessTokenVerifier,
  TokenRejectedError,
} from './access-token-verifier';

// Real jose, no mocks: tokens are signed in the test with a key pair generated
// here, and verified against a local key set that holds the public half.
const ISSUER = 'http://127.0.0.1:54321/auth/v1';
const KID = 'test-key-1';
const USER_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

let privateKey: CryptoKey;
let publicJwk: JWK;
let verifier: AccessTokenVerifier;

function baseClaims(overrides: JWTPayload = {}): JWTPayload {
  return { sub: USER_ID, role: 'authenticated', email: 'someone@example.com', ...overrides };
}

async function sign(
  claims: JWTPayload = baseClaims(),
  {
    key = privateKey,
    alg = 'ES256',
    kid = KID,
    // null omits the claim (undefined would select the default).
    issuer = ISSUER as string | null,
    audience = 'authenticated' as string | null,
    expiresIn = '10m' as string | number | null,
  } = {},
): Promise<string> {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg, kid }).setIssuedAt();
  if (issuer !== null) jwt.setIssuer(issuer);
  if (audience !== null) jwt.setAudience(audience);
  if (expiresIn !== null) jwt.setExpirationTime(expiresIn);
  return jwt.sign(key);
}

async function failure(token: string, using: AccessTokenVerifier = verifier): Promise<unknown> {
  try {
    await using.verify(token);
  } catch (error) {
    return error;
  }
  throw new Error('verify was expected to reject');
}

async function expectRejected(token: string, reason?: string): Promise<void> {
  const error = await failure(token);
  expect(error).toBeInstanceOf(TokenRejectedError);
  if (reason !== undefined) {
    expect((error as TokenRejectedError).reason).toBe(reason);
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  verifier = new JoseAccessTokenVerifier({ keys: createLocalJWKSet({ keys: [publicJwk] }), issuer: ISSUER });
});

describe('JoseAccessTokenVerifier', () => {
  it('accepts a valid ES256 token and returns only the user id', async () => {
    expect(await verifier.verify(await sign())).toEqual({ userId: USER_ID });
  });

  it('accepts an RS256 token signed with a key from the key set', async () => {
    const rsa = await generateKeyPair('RS256', { extractable: true });
    const rsaJwk = { ...(await exportJWK(rsa.publicKey)), kid: 'rsa-1', alg: 'RS256', use: 'sig' };
    const rsaVerifier = new JoseAccessTokenVerifier({ keys: createLocalJWKSet({ keys: [rsaJwk] }), issuer: ISSUER });
    const token = await sign(baseClaims(), { key: rsa.privateKey, alg: 'RS256', kid: 'rsa-1' });
    expect(await rsaVerifier.verify(token)).toEqual({ userId: USER_ID });
  });

  it('accepts an audience array that contains "authenticated"', async () => {
    const token = await new SignJWT(baseClaims({ aud: ['other', 'authenticated'] }))
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(ISSUER)
      .setExpirationTime('10m')
      .sign(privateKey);
    expect(await verifier.verify(token)).toEqual({ userId: USER_ID });
  });

  it('rejects an expired token', async () => {
    await expectRejected(await sign(baseClaims(), { expiresIn: Math.floor(Date.now() / 1000) - 60 }), 'JWTExpired');
  });

  it('rejects a token with no expiry', async () => {
    await expectRejected(await sign(baseClaims(), { expiresIn: null }), 'JWTClaimValidationFailed (exp: missing)');
  });

  it('rejects a wrong issuer and a missing issuer', async () => {
    await expectRejected(
      await sign(baseClaims(), { issuer: 'https://evil.example.com/auth/v1' }),
      'JWTClaimValidationFailed (iss: check_failed)',
    );
    await expectRejected(await sign(baseClaims(), { issuer: null }), 'JWTClaimValidationFailed (iss: missing)');
  });

  it('rejects a wrong audience and a missing audience', async () => {
    await expectRejected(await sign(baseClaims(), { audience: 'anon' }), 'JWTClaimValidationFailed (aud: check_failed)');
    await expectRejected(await sign(baseClaims(), { audience: null }), 'JWTClaimValidationFailed (aud: missing)');
  });

  it('rejects an HS256 token whose secret is the public key material (algorithm confusion)', async () => {
    const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const token = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(secret);
    await expectRejected(token, 'JOSEAlgNotAllowed');
  });

  it('rejects an HS256 token signed with the kid string as the secret', async () => {
    const token = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(KID));
    await expectRejected(token, 'JOSEAlgNotAllowed');
  });

  it('rejects an unsecured token with alg none', async () => {
    const token = new UnsecuredJWT(baseClaims())
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .encode();
    expect(token.endsWith('.')).toBe(true);
    await expectRejected(token);
  });

  it('rejects a tampered signature and a tampered payload', async () => {
    const token = await sign();
    const [header, payload, signature] = token.split('.');
    const flipped = (part: string) => `${part.slice(0, 10)}${part[10] === 'A' ? 'B' : 'A'}${part.slice(11)}`;
    await expectRejected([header, payload, flipped(signature)].join('.'), 'JWSSignatureVerificationFailed');
    const forged = Buffer.from(JSON.stringify({ ...baseClaims(), sub: '00000000-0000-4000-8000-000000000000', iss: ISSUER, aud: 'authenticated', exp: 9999999999 })).toString('base64url');
    await expectRejected([header, forged, signature].join('.'), 'JWSSignatureVerificationFailed');
  });

  it('rejects a token signed by a different key that claims the known kid', async () => {
    const other = await generateKeyPair('ES256');
    await expectRejected(await sign(baseClaims(), { key: other.privateKey }), 'JWSSignatureVerificationFailed');
  });

  it('rejects an unknown kid', async () => {
    await expectRejected(await sign(baseClaims(), { kid: 'unknown-kid' }), 'JWKSNoMatchingKey');
  });

  it.each([
    ['role anon', { role: 'anon' }, 'ClaimsRejected'],
    ['no role', { role: undefined }, 'ClaimsRejected'],
    ['a non-uuid sub', { sub: 'not-a-uuid' }, 'ClaimsRejected'],
    ['no sub', { sub: undefined }, 'JWTClaimValidationFailed (sub: missing)'],
    ['is_anonymous true', { is_anonymous: true }, 'ClaimsRejected'],
  ])('rejects the claims set with %s', async (_label, overrides, reason) => {
    const claims = { ...baseClaims(), ...overrides } as JWTPayload;
    await expectRejected(await sign(claims), reason);
  });

  it.each(['', 'abc', 'a.b', 'a.b.c', '....'])('rejects the malformed token %j', async (token) => {
    await expectRejected(token);
  });

  it('rejects a five-part (encrypted-looking) token', async () => {
    await expectRejected('a.b.c.d.e');
  });

  describe('when the keys cannot be reached', () => {
    const verifierWith = (keys: () => never) =>
      new JoseAccessTokenVerifier({ keys: (async () => keys()) as never, issuer: ISSUER });

    it.each([
      ['a JWKS timeout', () => { throw new errors.JWKSTimeout(); }],
      ['a non-200 or unparsable response (plain JOSEError)', () => { throw new errors.JOSEError('Expected 200 OK'); }],
      ['an invalid key set', () => { throw new errors.JWKSInvalid(); }],
      ['a network failure (plain TypeError)', () => { throw new TypeError('fetch failed'); }],
    ])('maps %s to AuthUnavailableError', async (_label, thrower) => {
      const token = await sign();
      await expect(verifierWith(thrower as () => never).verify(token)).rejects.toBeInstanceOf(AuthUnavailableError);
    });

    it('maps a real failed fetch of a remote key set to AuthUnavailableError', async () => {
      // Port 1 on loopback refuses the connection immediately; nothing real is contacted.
      const keys = createRemoteJWKSet(new URL('http://127.0.0.1:1/auth/v1/.well-known/jwks.json'), { timeoutDuration: 2_000 });
      const remoteVerifier = new JoseAccessTokenVerifier({ keys, issuer: ISSUER });
      await expect(remoteVerifier.verify(await sign())).rejects.toBeInstanceOf(AuthUnavailableError);
    });
  });

  it('names the failing claim and kind in the reason, never a value from the token', async () => {
    const distinctiveIssuer = 'https://sentinel-issuer-value.example/auth/v1';
    const token = await sign(baseClaims({ email: 'sentinel-email@example.com' }), { issuer: distinctiveIssuer });
    const error = (await failure(token)) as TokenRejectedError;
    expect(error.reason).toBe('JWTClaimValidationFailed (iss: check_failed)');
    const everything = JSON.stringify([error.message, error.reason, error.name]);
    for (const secret of [distinctiveIssuer, 'sentinel-issuer-value', 'sentinel-email', token, token.split('.')[1]]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('leaves out a claim name or kind it does not recognise', async () => {
    const hostile = new errors.JWTClaimValidationFailed('m', {}, 'sentinel-claim-name' as never, 'sentinel-kind' as never);
    const hostileVerifier = new JoseAccessTokenVerifier({
      keys: (async () => {
        throw hostile;
      }) as never,
      issuer: ISSUER,
    });
    const error = (await failure(await sign(), hostileVerifier)) as TokenRejectedError;
    expect(error.reason).toBe('JWTClaimValidationFailed');
  });

  it('never puts claims or the token in an error', async () => {
    const token = await sign(baseClaims({ email: 'leak-check@example.com' }), { audience: 'anon' });
    const error = (await failure(token)) as TokenRejectedError;
    expect(JSON.stringify([error.message, error.reason])).not.toContain('leak-check');
    expect(error.message).not.toContain(token);
  });
});

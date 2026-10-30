import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { describeError, describeTokenFault, TOKEN_FAULTS } from '../auth/access-token-verifier';
import type { JobQueueMode } from '../config/env';
import { LocalDispatchSecret } from '../providers/job-queue/local-dispatch-secret';

// The credential presented to /internal/* is bad: not a Google token for this
// service, or not the local secret. The caller gets 401.
export class InternalCredentialRejectedError extends Error {
  // A jose error class name (with the claim name and kind for a claim failure) or a
  // fixed word such as 'ClaimsRejected'. Never any part of the token or a claim value.
  constructor(readonly reason: string) {
    super('Internal credential rejected');
    this.name = 'InternalCredentialRejectedError';
  }
}

// We could not decide (the Google key set cannot be fetched). The caller gets 503,
// which makes Cloud Tasks retry instead of dropping the job.
export class InternalCredentialUnavailableError extends Error {
  constructor(readonly reason: string) {
    super('Internal authentication is unavailable');
    this.name = 'InternalCredentialUnavailableError';
  }
}

// An abstract class doubles as the injection token, so tests can substitute it.
// Resolves when the credential is good; throws one of the two errors above.
export abstract class InternalCredentialVerifier {
  abstract verify(token: string): Promise<void>;
}

// Google signs ID tokens with `iss` either as the URL or as the bare host, so both
// spellings are valid. Nothing else is.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

// Not called at import time: building the key set does no network I/O, but a module
// that only imports this file should not create one.
export function googleKeySet(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(GOOGLE_CERTS_URL), { timeoutDuration: 5_000 });
}

// Only what is checked after the signature, issuer, audience and expiry: the token
// must come from the one service account that Cloud Tasks and Scheduler run as.
const GoogleIdTokenClaimsSchema = z.object({
  email: z.string(),
  email_verified: z.literal(true),
});

export interface GoogleOidcVerifierOptions {
  // createRemoteJWKSet(googleKeySet) in production, a local key set in tests.
  keys: JWTVerifyGetKey;
  // Exact `aud` to expect: the URL of this service (INTERNAL_OIDC_AUDIENCE).
  audience: string;
  // Exact `email` to expect (INTERNAL_OIDC_SERVICE_ACCOUNT), compared case-sensitively.
  serviceAccountEmail: string;
}

// Verifies the OIDC token that Cloud Tasks / Cloud Scheduler attach (SECURITY.md
// rule 4). A Supabase user token fails on the issuer and the audience, so a user
// can never open /internal/*.
export class GoogleOidcVerifier extends InternalCredentialVerifier {
  constructor(private readonly options: GoogleOidcVerifierOptions) {
    super();
  }

  async verify(token: string): Promise<void> {
    let payload: unknown;
    try {
      const result = await jwtVerify(token, this.options.keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.options.audience,
        // Google signs with RS256. Anything else, `none` and HMAC included, is refused.
        algorithms: ['RS256'],
        // A token without an expiry would be valid forever.
        requiredClaims: ['exp', 'iat'],
      });
      payload = result.payload;
    } catch (error) {
      // Same split as JoseAccessTokenVerifier: a bad token is 401, anything we cannot
      // classify (a failed JWKS fetch, a timeout) is 503. Both deny.
      if (TOKEN_FAULTS.some((faultClass) => error instanceof faultClass)) {
        throw new InternalCredentialRejectedError(describeTokenFault(error as Error));
      }
      throw new InternalCredentialUnavailableError(describeError(error));
    }

    const claims = GoogleIdTokenClaimsSchema.safeParse(payload);
    if (!claims.success || claims.data.email !== this.options.serviceAccountEmail) {
      throw new InternalCredentialRejectedError('ClaimsRejected');
    }
  }
}

// Constant time whatever the length: both sides are hashed to 32 bytes first, so
// timingSafeEqual always gets equal-length buffers and the length is not leaked.
export class LocalSecretVerifier extends InternalCredentialVerifier {
  constructor(private readonly secret: LocalDispatchSecret) {
    super();
  }

  async verify(token: string): Promise<void> {
    if (token.length === 0) {
      throw new InternalCredentialRejectedError('SecretMismatch');
    }
    const presented = createHash('sha256').update(token).digest();
    const expected = createHash('sha256').update(this.secret.value).digest();
    if (!timingSafeEqual(presented, expected)) {
      throw new InternalCredentialRejectedError('SecretMismatch');
    }
  }
}

// Used when nothing is configured: every call is refused.
export class RejectAllVerifier extends InternalCredentialVerifier {
  async verify(): Promise<void> {
    throw new InternalCredentialRejectedError('NotConfigured');
  }
}

export interface InternalCredentialVerifierOptions {
  mode: JobQueueMode;
  audience: string | undefined;
  serviceAccountEmail: string | undefined;
  keys: JWTVerifyGetKey;
  secret: LocalDispatchSecret;
}

// INVARIANT: the local secret is accepted in 'local' mode and in no other mode.
// The 'local' branch returns the secret verifier and never an OIDC one; the other
// two branches never construct a LocalSecretVerifier. env.ts refuses 'local' on
// Cloud Run and in production, so the secret cannot be accepted there either.
export function createInternalCredentialVerifier(
  options: InternalCredentialVerifierOptions,
): InternalCredentialVerifier {
  const { mode, audience, serviceAccountEmail, keys, secret } = options;
  const hasOidcConfig = audience !== undefined && audience !== '' && serviceAccountEmail !== undefined && serviceAccountEmail !== '';
  switch (mode) {
    case 'local':
      return new LocalSecretVerifier(secret);
    case 'cloud-tasks':
      if (!hasOidcConfig) {
        throw new Error('JOB_QUEUE=cloud-tasks needs INTERNAL_OIDC_AUDIENCE and INTERNAL_OIDC_SERVICE_ACCOUNT');
      }
      return new GoogleOidcVerifier({ keys, audience, serviceAccountEmail });
    case 'none':
      return hasOidcConfig
        ? new GoogleOidcVerifier({ keys, audience, serviceAccountEmail })
        : new RejectAllVerifier();
  }
}

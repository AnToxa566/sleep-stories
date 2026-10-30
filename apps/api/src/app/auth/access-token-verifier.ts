import { AccessTokenClaimsSchema } from '@sleep-stories/contracts';
import { errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

// What the rest of the API gets from a verified token: the user id and nothing
// else. Email, role and the other claims are none of its business.
export interface VerifiedAccessToken {
  userId: string;
}

// The token is bad: bad signature, expired, wrong issuer, audience or algorithm,
// malformed, or claims we do not accept. The caller gets 401 and signs out.
export class TokenRejectedError extends Error {
  // The jose error class name, followed for a claim failure by the claim name and
  // the failure kind, e.g. `JWTClaimValidationFailed (iss: check_failed)`; or
  // 'ClaimsRejected'. Safe to log: see describeTokenFault, it never contains a
  // message, a claim value or any part of the token.
  constructor(readonly reason: string) {
    super('Access token rejected');
    this.name = 'TokenRejectedError';
  }
}

// We could not decide: the key set cannot be fetched or is unusable. The caller
// gets 503 and must NOT sign the user out because Auth is down.
export class AuthUnavailableError extends Error {
  constructor(readonly reason: string) {
    super('Authentication is unavailable');
    this.name = 'AuthUnavailableError';
  }
}

// An abstract class doubles as the injection token, so tests can substitute it.
export abstract class AccessTokenVerifier {
  abstract verify(token: string): Promise<VerifiedAccessToken>;
}

export interface JoseAccessTokenVerifierOptions {
  // Resolves the signing key for a token: createRemoteJWKSet in production, a
  // createLocalJWKSet in tests. Injectable on purpose.
  keys: JWTVerifyGetKey;
  // Exact `iss` to expect, e.g. https://<ref>.supabase.co/auth/v1.
  issuer: string;
}

// Asymmetric algorithms only. HS256 must never be accepted: the key set is public,
// so a token "signed" with a public key as an HMAC secret would otherwise verify
// (algorithm confusion). `none` is rejected by this list as well.
const ALLOWED_ALGORITHMS = ['ES256', 'RS256'];

// jose errors that mean "this token is bad". Everything else is treated as "cannot
// decide" (503): that includes a timeout, a non-200 or unparsable JWKS response,
// an invalid key set, and network errors, which jose lets through as plain
// TypeError. Failing the other way would be unsafe: an unknown error must never
// become a pass, and as a 503 it still denies access. The cost is that an
// unexpected error caused by a weird token answers 503 instead of 401, which only
// means the app does not sign out.
// JWKSNoMatchingKey is the token's fault: jose already refetched the key set
// when the cooldown allowed it, so the kid is simply unknown.
const TOKEN_FAULTS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWEInvalid,
  errors.JWEDecryptionFailed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
] as const;

export class JoseAccessTokenVerifier extends AccessTokenVerifier {
  constructor(private readonly options: JoseAccessTokenVerifierOptions) {
    super();
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    let payload: unknown;
    try {
      const result = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: 'authenticated',
        algorithms: ALLOWED_ALGORITHMS,
        // A token without an expiry would be valid forever.
        requiredClaims: ['exp', 'sub'],
      });
      payload = result.payload;
    } catch (error) {
      if (TOKEN_FAULTS.some((faultClass) => error instanceof faultClass)) {
        throw new TokenRejectedError(describeTokenFault(error as Error));
      }
      throw new AuthUnavailableError(describeError(error));
    }

    const claims = AccessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new TokenRejectedError('ClaimsRejected');
    }
    return { userId: claims.data.sub };
  }
}

// Claim names that jose can report for a JWTClaimValidationFailed here: the registered
// claims it validates. Anything else is left out of the reason rather than logged.
const LOGGABLE_CLAIMS: readonly unknown[] = ['iss', 'aud', 'sub', 'exp', 'nbf', 'iat', 'jti', 'typ'];
const LOGGABLE_CLAIM_REASONS: readonly unknown[] = ['missing', 'check_failed', 'invalid'];

// The reason for a rejected token, for logs: the error class name and, for a claim
// failure, which claim failed and how. Those two fields tell an operator that the
// issuer does not match (`iss: check_failed`) without any value. They are checked
// against fixed lists first, and the claim's value, jose's message and the payload
// are never read.
function describeTokenFault(error: Error): string {
  const name = error.constructor.name;
  if (!(error instanceof errors.JWTClaimValidationFailed)) {
    return name;
  }
  const { claim, reason } = error;
  if (!LOGGABLE_CLAIMS.includes(claim) || !LOGGABLE_CLAIM_REASONS.includes(reason)) {
    return name;
  }
  return `${name} (${claim}: ${reason})`;
}

// Class name and jose code only, for logs.
function describeError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : 'Error';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name}, ${code}` : name;
}

import { z } from 'zod';

const REQUIRED_AUDIENCE = 'authenticated';
const REQUIRED_ROLE = 'authenticated';

// Loose on purpose: Supabase access tokens carry other claims (iss, exp, email,
// app_metadata, ...) that are none of our business. Only the claims we rely on
// are checked, and the user id is read from `sub` alone.
export const AccessTokenClaimsSchema = z.looseObject({
  sub: z.uuid(),
  role: z.literal(REQUIRED_ROLE),
  aud: z.union([z.string(), z.array(z.string())]).refine(
    (aud) =>
      Array.isArray(aud) ? aud.includes(REQUIRED_AUDIENCE) : aud === REQUIRED_AUDIENCE,
    { error: `aud must be or contain "${REQUIRED_AUDIENCE}"` },
  ),
  // Anonymous sign-ins are not supported: if the claim is present it is false.
  is_anonymous: z.literal(false).optional(),
});

export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

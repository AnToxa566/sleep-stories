import { AccessTokenClaimsSchema } from './auth';

const claims = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aud: 'authenticated',
};

describe('AccessTokenClaimsSchema', () => {
  it('accepts minimal valid claims', () => {
    expect(AccessTokenClaimsSchema.safeParse(claims).success).toBe(true);
  });

  it('rejects role anon', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, role: 'anon' }).success).toBe(false);
  });

  it('rejects a non-uuid sub', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, sub: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects a missing sub', () => {
    expect(
      AccessTokenClaimsSchema.safeParse({ role: claims.role, aud: claims.aud }).success,
    ).toBe(false);
  });

  it('accepts an aud array containing authenticated', () => {
    expect(
      AccessTokenClaimsSchema.safeParse({ ...claims, aud: ['other', 'authenticated'] }).success,
    ).toBe(true);
  });

  it('rejects an aud array without authenticated', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, aud: ['other'] }).success).toBe(false);
  });

  it('rejects a different aud string', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, aud: 'service' }).success).toBe(false);
  });

  it('rejects a missing aud', () => {
    expect(
      AccessTokenClaimsSchema.safeParse({ sub: claims.sub, role: claims.role }).success,
    ).toBe(false);
  });

  it('rejects is_anonymous true', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, is_anonymous: true }).success).toBe(
      false,
    );
  });

  it('accepts is_anonymous false', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, is_anonymous: false }).success).toBe(
      true,
    );
  });

  it('rejects is_anonymous as the string "true"', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, is_anonymous: 'true' }).success).toBe(
      false,
    );
  });

  it('rejects is_anonymous null', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, is_anonymous: null }).success).toBe(
      false,
    );
  });

  it('rejects an empty aud array', () => {
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, aud: [] }).success).toBe(false);
  });

  it('keeps role and aud independent: a wrong role with a valid aud is rejected', () => {
    expect(
      AccessTokenClaimsSchema.safeParse({ ...claims, role: 'service_role', aud: ['authenticated'] })
        .success,
    ).toBe(false);
  });

  it('accepts unknown extra claims and keeps them', () => {
    const result = AccessTokenClaimsSchema.safeParse({
      ...claims,
      iss: 'http://127.0.0.1:54321/auth/v1',
      exp: 1_900_000_000,
      app_metadata: { provider: 'email' },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data['iss']).toBe('http://127.0.0.1:54321/auth/v1');
  });
});

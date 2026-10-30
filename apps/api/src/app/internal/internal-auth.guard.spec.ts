import { ExecutionContext, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiErrorResponseSchema } from '@sleep-stories/contracts';
import { InternalAuthGuard } from './internal-auth.guard';
import {
  InternalCredentialRejectedError,
  InternalCredentialUnavailableError,
  InternalCredentialVerifier,
} from './internal-credential.verifier';

const GOOD = 'sentinel-internal-good';
const BAD = 'sentinel-internal-bad';
const DOWN = 'sentinel-internal-down';
const BOOM = 'sentinel-internal-boom';

class FakeVerifier extends InternalCredentialVerifier {
  readonly calls: string[] = [];

  async verify(token: string): Promise<void> {
    this.calls.push(token);
    switch (token) {
      case GOOD:
        return;
      case BAD:
        throw new InternalCredentialRejectedError('JWTExpired');
      case DOWN:
        throw new InternalCredentialUnavailableError('JWKSTimeout, ERR_JWKS_TIMEOUT');
      default:
        throw new Error(`unexpected failure for ${token}`);
    }
  }
}

function contextWith(authorization: string | string[] | undefined, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization === undefined ? {} : { authorization } }) }),
  } as unknown as ExecutionContext;
}

describe('InternalAuthGuard', () => {
  let verifier: FakeVerifier;
  let guard: InternalAuthGuard;
  const spies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );

  beforeEach(() => {
    verifier = new FakeVerifier();
    guard = new InternalAuthGuard(verifier);
    spies.forEach((spy) => spy.mockClear());
  });

  afterAll(() => spies.forEach((spy) => spy.mockRestore()));

  it('lets a good credential through', async () => {
    await expect(guard.canActivate(contextWith(`Bearer ${GOOD}`))).resolves.toBe(true);
    expect(verifier.calls).toEqual([GOOD]);
  });

  it('accepts the scheme in any letter case', async () => {
    await expect(guard.canActivate(contextWith(`bearer ${GOOD}`))).resolves.toBe(true);
  });

  it.each([
    ['no Authorization header', undefined],
    ['the Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty header', ''],
    ['the scheme alone', 'Bearer'],
    ['an empty bearer token', 'Bearer '],
    ['two spaces before the token', `Bearer  ${GOOD}`],
    ['a token followed by more text', `Bearer ${GOOD} extra`],
    ['a tab instead of a space', `Bearer\t${GOOD}`],
    ['no scheme', GOOD],
    ['an oversized token', `Bearer ${'a'.repeat(9000)}`],
    ['a repeated header', [`Bearer ${GOOD}`, `Bearer ${GOOD}`]],
  ])('answers 401 for %s, without calling the verifier', async (_label, header) => {
    await expect(guard.canActivate(contextWith(header))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifier.calls).toEqual([]);
  });

  it('answers 401 for a non-http context', async () => {
    await expect(guard.canActivate(contextWith(`Bearer ${GOOD}`, 'rpc'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifier.calls).toEqual([]);
  });

  it('answers 401 unauthorized when the credential is rejected', async () => {
    const error = await guard.canActivate(contextWith(`Bearer ${BAD}`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(ApiErrorResponseSchema.parse((error as UnauthorizedException).getResponse())).toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
    });
  });

  it('answers 503 auth_unavailable when the keys cannot be reached, so the queue retries', async () => {
    const error = await guard.canActivate(contextWith(`Bearer ${DOWN}`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(ApiErrorResponseSchema.parse((error as ServiceUnavailableException).getResponse())).toMatchObject({
      statusCode: 503,
      code: 'auth_unavailable',
    });
  });

  it('denies with 503, not a pass, on an error nobody anticipated', async () => {
    await expect(guard.canActivate(contextWith(`Bearer ${BOOM}`))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('logs only outcome classes, never the token or an error message', async () => {
    for (const token of [GOOD, BAD, DOWN, BOOM]) {
      await guard.canActivate(contextWith(`Bearer ${token}`)).catch(() => undefined);
    }
    const logged = spies.flatMap((spy) => spy.mock.calls).map((call) => JSON.stringify(call));
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain('sentinel-internal');
      expect(line).not.toContain('unexpected failure');
    }
    expect(logged.join('\n')).toContain('JWTExpired');
    expect(logged.join('\n')).toContain('ERR_JWKS_TIMEOUT');
  });
});

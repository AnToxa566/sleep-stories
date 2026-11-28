import { inspect } from 'node:util';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../platform/config/env';
import { AUTH_ADMIN_TIMEOUT_MS, AuthAdminError, AuthAdminService } from './auth-admin.service';

// The real SDK with a stubbed global fetch: what is tested includes how the installed
// @supabase/auth-js turns a response into an error. Nothing leaves the process.

// Fake values that exist only in this file.
const URL_VALUE = 'http://auth-host.test:54321';
const KEY = 'fake-service-role-key-for-unit-tests';
const USER_ID = '3f0b8a52-7c1e-4d0a-9a57-1b2c3d4e5f60';
const SDK_TEXT = 'sdk-error-text-with-person@example.test';

function makeService(): AuthAdminService {
  const values: Record<string, string> = { SUPABASE_URL: URL_VALUE, SUPABASE_SERVICE_ROLE_KEY: KEY };
  const config = { get: (name: string) => values[name] } as unknown as ConfigService<Env, true>;
  return new AuthAdminService(config);
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AuthAdminService.deleteUser', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  const consoleSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => undefined));
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    consoleSpies.length = 0;
  });

  async function failure(): Promise<unknown> {
    return makeService()
      .deleteUser(USER_ID)
      .then(
        () => {
          throw new Error('expected a failure');
        },
        (error: unknown) => error,
      );
  }

  function expectFixedError(error: unknown): void {
    expect(error).toBeInstanceOf(AuthAdminError);
    expect((error as Error).message).toBe('Auth admin request failed');
    expect(Object.keys(error as object)).not.toContain('cause');
    expect(inspect(error, { depth: 5 })).not.toContain(SDK_TEXT);
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  }

  it('sends one hard delete for exactly this id, with the key and a timeout signal', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchSpy.mockResolvedValue(json(200, { id: USER_ID }));

    await expect(makeService().deleteUser(USER_ID)).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${URL_VALUE}/auth/v1/admin/users/${USER_ID}`);
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ should_soft_delete: false });
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(timeout).toHaveBeenCalledWith(AUTH_ADMIN_TIMEOUT_MS);
    expect(init?.signal).toBe(timeout.mock.results[0].value);
  });

  it('treats a user that does not exist as success', async () => {
    fetchSpy.mockResolvedValue(
      json(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' }),
    );
    await expect(makeService().deleteUser(USER_ID)).resolves.toBeUndefined();
  });

  it.each([
    ['a 404 without a code', 404, { message: SDK_TEXT }],
    ['a 404 with another code', 404, { error_code: 'something_else', msg: SDK_TEXT }],
    ['user_not_found with another status', 400, { error_code: 'user_not_found', msg: SDK_TEXT }],
    ['a rejected key', 401, { error_code: 'bad_jwt', msg: SDK_TEXT }],
    ['a forbidden call', 403, { error_code: 'not_admin', msg: SDK_TEXT }],
    ['a server error', 500, { msg: SDK_TEXT }],
    ['an unavailable service', 503, { msg: SDK_TEXT }],
  ])('fails with the fixed error on %s', async (_name, status, body) => {
    fetchSpy.mockResolvedValue(json(status, body));
    expectFixedError(await failure());
  });

  it('fails on a 404 that is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response(SDK_TEXT, { status: 404 }));
    expectFixedError(await failure());
  });

  it('fails with the fixed error when the network fails', async () => {
    fetchSpy.mockRejectedValue(new TypeError(SDK_TEXT));
    expectFixedError(await failure());
  });

  it('fails with the fixed error when the call times out', async () => {
    // The timer is replaced by a signal that is already expired.
    const expired = AbortSignal.abort(new DOMException(SDK_TEXT, 'TimeoutError'));
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(expired);
    fetchSpy.mockImplementation(async (_input, init) => {
      init?.signal?.throwIfAborted();
      return json(200, { id: USER_ID });
    });
    expectFixedError(await failure());
  });

  it('fails without a request for an id that is not a UUID', async () => {
    await expect(makeService().deleteUser('../not-a-uuid')).rejects.toBeInstanceOf(AuthAdminError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

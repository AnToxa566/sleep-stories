import { MeResponseSchema, CompleteOnboardingRequestSchema } from '@sleep-stories/contracts';
import { ApiContractError, ApiError, ApiUnavailableError, createApiClient } from './api-client';

const TOKEN = 'eyJ.secret-token-value.signature';
const BASE = 'http://10.0.0.5:3000/api';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = { url: string; init: RequestInit };

function setup(respond: (call: Call) => Promise<Response> | Response, token: string | null = TOKEN) {
  const calls: Call[] = [];
  const onUnauthorized = jest.fn();
  const apiFetch = createApiClient({
    baseUrl: BASE,
    getAccessToken: async () => token,
    onUnauthorized,
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
  });
  return { apiFetch, calls, onUnauthorized };
}

const me = { method: 'GET', path: '/me', responseSchema: MeResponseSchema } as const;
const notOnboarded = { onboardingCompleted: false, preferences: null };

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

describe('apiFetch', () => {
  it('sends the bearer token and parses the response with the schema', async () => {
    const { apiFetch, calls } = setup(() => json(200, notOnboarded));
    await expect(apiFetch(me)).resolves.toEqual(notOnboarded);
    expect(calls[0]?.url).toBe(`${BASE}/me`);
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('throws ApiContractError when the body does not match the schema', async () => {
    const { apiFetch } = setup(() => json(200, { onboardingCompleted: true, preferences: null }));
    await expect(apiFetch(me)).rejects.toBeInstanceOf(ApiContractError);
  });

  it('validates and sends a request body from its schema', async () => {
    const body = { voiceSlug: 'anna', styles: ['facts' as const], interestSlugs: ['space'] };
    const { apiFetch, calls } = setup(() => json(200, notOnboarded));
    await apiFetch({
      method: 'PUT',
      path: '/me/onboarding',
      body: { schema: CompleteOnboardingRequestSchema, value: body },
      responseSchema: MeResponseSchema,
    });
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(body);
  });

  it('refuses to send a body that fails its schema', async () => {
    const { apiFetch, calls } = setup(() => json(200, notOnboarded));
    await expect(
      apiFetch({
        method: 'PUT',
        path: '/me/onboarding',
        body: { schema: CompleteOnboardingRequestSchema, value: { voiceSlug: '', styles: [], interestSlugs: [] } },
        responseSchema: MeResponseSchema,
      }),
    ).rejects.toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('calls onUnauthorized on a 401 and throws ApiError', async () => {
    const { apiFetch, onUnauthorized } = setup(() =>
      json(401, { statusCode: 401, code: 'unauthorized', message: 'Unauthorized' }),
    );
    const error = await errorOf(apiFetch(me));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('treats a missing token as a 401 without calling the server', async () => {
    const { apiFetch, calls, onUnauthorized } = setup(() => json(200, notOnboarded), null);
    const error = await errorOf(apiFetch(me));
    expect((error as ApiError).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not sign out on 503 and throws ApiUnavailableError', async () => {
    const { apiFetch, onUnauthorized } = setup(() =>
      json(503, { statusCode: 503, code: 'auth_unavailable', message: 'down' }),
    );
    await expect(apiFetch(me)).rejects.toBeInstanceOf(ApiUnavailableError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not sign out on a network failure', async () => {
    const { apiFetch, onUnauthorized } = setup(() => {
      throw new TypeError('Network request failed');
    });
    await expect(apiFetch(me)).rejects.toBeInstanceOf(ApiUnavailableError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('maps Nest default 404 and 500 bodies (no code) to a generic ApiError', async () => {
    for (const status of [404, 500]) {
      const { apiFetch, onUnauthorized } = setup(() =>
        json(status, { statusCode: status, message: 'Not Found' }),
      );
      const error = await errorOf(apiFetch(me));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect((error as ApiError).code).toBeNull();
      expect(onUnauthorized).not.toHaveBeenCalled();
    }
  });

  it('maps a non-JSON error body to a generic ApiError', async () => {
    const { apiFetch } = setup(() => new Response('<html>Bad Gateway-ish</html>', { status: 418 }));
    const error = await errorOf(apiFetch(me));
    expect((error as ApiError).status).toBe(418);
    expect((error as ApiError).code).toBeNull();
  });

  it('keeps the server error code when the body is our error shape', async () => {
    const { apiFetch } = setup(() =>
      json(422, { statusCode: 422, code: 'unknown_voice', message: 'Unknown voice' }),
    );
    const error = await errorOf(apiFetch(me));
    expect((error as ApiError).code).toBe('unknown_voice');
  });

  it('never puts the token into an error message', async () => {
    const cases: Array<() => Promise<Response> | Response> = [
      () => json(401, { statusCode: 401, code: 'unauthorized', message: `bad ${TOKEN}` }),
      () => json(500, { statusCode: 500, message: `leaked ${TOKEN}` }),
      () => json(503, { message: TOKEN }),
      () => json(200, { leaked: TOKEN }),
      () => {
        throw new TypeError(`request with Bearer ${TOKEN} failed`);
      },
    ];
    for (const respond of cases) {
      const { apiFetch } = setup(respond);
      const error = (await errorOf(apiFetch(me))) as Error;
      expect(error.message).not.toContain(TOKEN);
      expect(String(error.stack ?? '')).not.toContain(TOKEN);
    }
  });

  it('times out after the configured time without signing out', async () => {
    jest.useFakeTimers();
    try {
      const onUnauthorized = jest.fn();
      const apiFetch = createApiClient({
        baseUrl: BASE,
        getAccessToken: async () => TOKEN,
        onUnauthorized,
        timeoutMs: 15_000,
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      });
      const result = errorOf(apiFetch(me));
      await jest.advanceTimersByTimeAsync(15_000);
      const error = await result;
      expect(error).toBeInstanceOf(ApiUnavailableError);
      expect((error as Error).message).toContain('timeout');
      expect(onUnauthorized).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

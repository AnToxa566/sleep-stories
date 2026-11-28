import { createClient } from '@supabase/supabase-js';
import { limitedFetch } from './limited-fetch';

// A request that never answers and ends only when it is aborted, like a stalled network.
const stalled: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('limitedFetch', () => {
  afterEach(() => jest.useRealTimers());

  it('aborts a request that gets no answer within the limit, and not before', async () => {
    jest.useFakeTimers();
    let settled = false;
    const request = limitedFetch(stalled, 1000)('http://test.invalid').finally(() => {
      settled = true;
    });
    const outcome = expect(request).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await outcome;
  });

  it('passes the answer and the request through, and leaves no timer behind', async () => {
    jest.useFakeTimers();
    const response = new Response('ok');
    const inner = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response);
    await expect(
      limitedFetch(inner, 1000)('http://test.invalid', { method: 'POST' }),
    ).resolves.toBe(response);
    expect(inner.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('still aborts when the caller aborts, before or during the request', async () => {
    const during = new AbortController();
    const first = limitedFetch(stalled, 60_000)('http://test.invalid', { signal: during.signal });
    during.abort();
    await expect(first).rejects.toThrow('aborted');

    const before = new AbortController();
    before.abort();
    const inner = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_i, init) => {
      if (init?.signal?.aborted) throw new Error('aborted');
      return new Response('ok');
    });
    await expect(
      limitedFetch(inner, 60_000)('http://test.invalid', { signal: before.signal }),
    ).rejects.toThrow('aborted');
  });

  // The case the limit exists for, with the real library: the sign-out request stalls.
  it('lets supabase-js sign-out finish and remove the local session when the server stalls', async () => {
    const stored = new Map<string, string>();
    stored.set(
      'test.auth',
      JSON.stringify({
        access_token: 'not-a-real-token',
        refresh_token: 'not-a-real-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '00000000-0000-4000-8000-000000000000' },
      }),
    );
    const asked: string[] = [];
    const client = createClient('http://test.invalid', 'not-a-real-key', {
      global: {
        fetch: limitedFetch((input, init) => {
          asked.push(String(input));
          return stalled(input, init);
        }, 50),
      },
      auth: {
        storageKey: 'test.auth',
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
        storage: {
          getItem: (key) => stored.get(key) ?? null,
          setItem: (key, value) => void stored.set(key, value),
          removeItem: (key) => void stored.delete(key),
        },
      },
    });

    const { error } = await client.auth.signOut();

    expect(asked.some((url) => url.includes('/logout'))).toBe(true);
    expect(error).not.toBeNull();
    expect(stored.has('test.auth')).toBe(false);
  });
});

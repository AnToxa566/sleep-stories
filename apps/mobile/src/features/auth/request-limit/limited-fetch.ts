// A time limit for the requests of the Supabase auth client. Neither supabase-js nor React
// Native on Android limits them, and `signOut` asks the server BEFORE it removes the session
// from the device: a stalled network would keep the person signed in for as long as it lasts.
// After an account deletion that means a sheet that cannot be closed, over an account that no
// longer exists (ARCHITECTURE.md section 7, «Настройки»).
//
// An aborted request is an ordinary network error for the library, so sign-out ends: with a
// valid token the library removes the local session itself, with an expired one the last step of
// `signOutEverywhere` does. A limit on the request, not a race around `signOut`, because an
// abandoned call that finished later would remove whatever session is stored by then.
//
// The limit covers the wait for the response, not the reading of its body. A JavaScript timer
// does not fire while the app is in the background; the request is then limited once the app
// is in front again.

export const AUTH_REQUEST_LIMIT_MS = 10_000;

export function limitedFetch(fetchImpl: typeof fetch, limitMs: number): typeof fetch {
  return async (input, init) => {
    // AbortSignal.timeout is not relied on: the app's JavaScript engine may lack it.
    const controller = new AbortController();
    const abort = () => controller.abort();
    // A signal the caller passed still aborts the request.
    const callerSignal = init?.signal;
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener('abort', abort);
    const timer = setTimeout(abort, limitMs);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
    }
  };
}

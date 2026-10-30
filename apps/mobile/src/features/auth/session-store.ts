import { create } from 'zustand';
import { authStorage, AUTH_STORAGE_KEY, supabase } from './supabase';
import type { SessionStatus } from './session-status';

type SessionState = {
  status: SessionStatus;
  // The id of the signed-in user, used only as a cache key. Never sent to the API: the API
  // reads the user from the token.
  userId: string | null;
};

export const useSessionStore = create<SessionState>(() => ({
  status: 'restoring',
  userId: null,
}));

function apply(next: SessionState): void {
  const current = useSessionStore.getState();
  if (current.status === next.status && current.userId === next.userId) return;
  useSessionStore.setState(next);
  // Whoever was signed in is gone or replaced: clear their data on every path (logout, a 401,
  // a revoked refresh token, a wiped session), not only the logout button. The cleanups call
  // no Supabase method, so running them inside the auth callback is safe.
  if (current.userId !== null && current.userId !== next.userId) runSignOutCleanups();
}

// Fires with INITIAL_SESSION first, then on every sign-in, sign-out and token refresh.
// The callback only copies state: calling another Supabase method from inside it can
// deadlock the client (documented), so any follow-up work belongs outside.
supabase.auth.onAuthStateChange((_event, session) => {
  apply(
    session
      ? { status: 'signedIn', userId: session.user.id }
      : { status: 'signedOut', userId: null },
  );
});

// Cleanup that must run after logout (clear the query cache, reset the onboarding store).
// A callback list keeps this module free of imports from screens and the API layer.
const signOutCleanups: Array<() => void> = [];

function runSignOutCleanups(): void {
  for (const cleanup of signOutCleanups) {
    try {
      cleanup();
    } catch {
      // One failing cleanup must not skip the others.
    }
  }
}

export function registerSignOutCleanup(cleanup: () => void): () => void {
  signOutCleanups.push(cleanup);
  return () => {
    const index = signOutCleanups.indexOf(cleanup);
    if (index >= 0) signOutCleanups.splice(index, 1);
  };
}

export async function signOutEverywhere(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut();
    // A network error leaves the local session in place: fall back to a local sign-out.
    if (error) await supabase.auth.signOut({ scope: 'local' });
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
  // Belt and braces: whatever happened above, no session may stay on the device.
  await authStorage.removeItem(AUTH_STORAGE_KEY).catch(() => undefined);
  apply({ status: 'signedOut', userId: null });
}

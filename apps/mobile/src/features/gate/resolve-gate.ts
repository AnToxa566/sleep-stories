import type { MeResponse } from '@sleep-stories/contracts';
import { ApiError } from '../../api/api-client';
import type { SessionStatus } from '../auth/session-status';

// Which part of the app the user may see. Pure, so every combination is unit-tested.
export type Gate = 'splash' | 'auth' | 'onboarding' | 'home' | 'error';

// What the gate needs to know about the GET /me query.
export type MeState =
  | { kind: 'loading' }
  | { kind: 'ready'; onboardingCompleted: boolean }
  // `unauthorized`: the server rejected the token. The 401 handler signs the user out and
  // the session status follows, so this is only a moment on the splash, never an error screen.
  | { kind: 'failed'; unauthorized: boolean };

export function resolveGate(session: SessionStatus, me: MeState): Gate {
  switch (session) {
    case 'restoring':
      return 'splash';
    case 'signedOut':
      return 'auth';
    case 'signedIn':
      switch (me.kind) {
        case 'loading':
          return 'splash';
        case 'ready':
          return me.onboardingCompleted ? 'home' : 'onboarding';
        case 'failed':
          return me.unauthorized ? 'splash' : 'error';
      }
  }
}

// The slice of a TanStack Query result the gate reads.
export type MeQuerySnapshot = {
  status: 'pending' | 'success' | 'error';
  data: MeResponse | undefined;
  error: unknown;
};

export function toMeState(query: MeQuerySnapshot): MeState {
  // Data wins over a later error: a failed background refetch must not kick a user who
  // already has a /me result out of Home.
  if (query.data) return { kind: 'ready', onboardingCompleted: query.data.onboardingCompleted };
  if (query.status === 'error') {
    return {
      kind: 'failed',
      unauthorized: query.error instanceof ApiError && query.error.status === 401,
    };
  }
  return { kind: 'loading' };
}

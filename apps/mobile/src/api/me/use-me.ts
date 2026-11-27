import { MeResponseSchema } from '@sleep-stories/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../features/auth/session/session-store';
import { apiFetch } from '../http/api-fetch';

export const meQueryKey = (userId: string | null) => ['me', userId] as const;

// GET /me. Runs only while signed in; the key carries the user id so one account's data
// is never shown to another after a switch.
export function useMe() {
  const status = useSessionStore((state) => state.status);
  const userId = useSessionStore((state) => state.userId);
  return useQuery({
    queryKey: meQueryKey(userId),
    queryFn: () => apiFetch({ method: 'GET', path: '/me', responseSchema: MeResponseSchema }),
    enabled: status === 'signedIn' && userId !== null,
  });
}

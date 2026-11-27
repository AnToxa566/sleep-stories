import { VoicesResponseSchema } from '@sleep-stories/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../features/auth/session/session-store';
import { apiFetch } from '../http/api-fetch';

export const voicesQueryKey = ['voices'] as const;

// GET /voices. Same for every user, so no user id in the key; runs only while signed in
// because the endpoint needs the JWT.
export function useVoices() {
  const status = useSessionStore((state) => state.status);
  return useQuery({
    queryKey: voicesQueryKey,
    queryFn: () =>
      apiFetch({ method: 'GET', path: '/voices', responseSchema: VoicesResponseSchema }),
    enabled: status === 'signedIn',
  });
}

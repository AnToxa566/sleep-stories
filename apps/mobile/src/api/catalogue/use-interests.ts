import { InterestsResponseSchema } from '@sleep-stories/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../features/auth/session/session-store';
import { apiFetch } from '../http/api-fetch';

export const interestsQueryKey = ['interests'] as const;

// GET /interests. The catalogue is the same for every user, so the key has no user id;
// it runs only while signed in because the endpoint needs the JWT.
export function useInterests() {
  const status = useSessionStore((state) => state.status);
  return useQuery({
    queryKey: interestsQueryKey,
    queryFn: () =>
      apiFetch({ method: 'GET', path: '/interests', responseSchema: InterestsResponseSchema }),
    enabled: status === 'signedIn',
  });
}

import {
  CompleteOnboardingRequestSchema,
  MeResponseSchema,
  type CompleteOnboardingRequest,
  type MeResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../features/auth/session-store';
import { apiFetch } from './api-fetch';

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

// PUT /me/onboarding. The response is the new /me, so the cache is filled directly and the
// gate moves to Home without another round trip. The server call is idempotent: a repeated
// "Готово" returns the same result.
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.userId);
  return useMutation<MeResponse, Error, CompleteOnboardingRequest>({
    mutationFn: (request) =>
      apiFetch({
        method: 'PUT',
        path: '/me/onboarding',
        body: { schema: CompleteOnboardingRequestSchema, value: request },
        responseSchema: MeResponseSchema,
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(meQueryKey(userId), response);
    },
  });
}

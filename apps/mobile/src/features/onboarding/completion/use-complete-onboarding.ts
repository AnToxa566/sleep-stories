import {
  CompleteOnboardingRequestSchema,
  MeResponseSchema,
  type CompleteOnboardingRequest,
  type MeResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../api/http/api-fetch';
import { meQueryKey } from '../../../api/me/use-me';
import { useSessionStore } from '../../auth/session/session-store';

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

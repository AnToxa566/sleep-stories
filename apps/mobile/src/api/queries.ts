import {
  ChangeVoiceRequestSchema,
  CompleteOnboardingRequestSchema,
  InterestsResponseSchema,
  MeResponseSchema,
  VoicesResponseSchema,
  type ChangeVoiceRequest,
  type CompleteOnboardingRequest,
  type MeResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../features/auth/session/session-store';
import { apiFetch } from './api-fetch';
import {
  applyPreferenceSaved,
  applyPreferenceSaveFailed,
  type PreferenceChangeKeys,
} from './preference-change/preference-change-cache';
import { queueQueryKey, topicsUserKey } from './query-keys';

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

export const changeVoiceMutationKey = ['change-voice'] as const;

type ChangeVoiceCallbacks = {
  onSaved?: (response: MeResponse) => void;
  onFailed?: () => void;
};

// PUT /me/voice: changes only the narrator and answers with the new /me. It creates no job.
// Never retried by itself: the person presses the button again. What it does to the cache is in
// preference-change/preference-change-cache.ts. Which stories are ready depends on the narrator,
// so a save makes the queue and the topic lists stale; the voices do not depend on the choice.
// A failure reads the voices again too: a refused voice (`unknown_voice`) means the list is out
// of date.
//
// `onSaved` and `onFailed` are in the hook's own options, so they run even when the screen was
// closed while the request was out; callbacks passed to `mutate` would not.
export function useChangeVoice(callbacks: ChangeVoiceCallbacks = {}) {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.userId);
  return useMutation<MeResponse, Error, ChangeVoiceRequest, PreferenceChangeKeys>({
    mutationKey: changeVoiceMutationKey,
    mutationFn: (request) =>
      apiFetch({
        method: 'PUT',
        path: '/me/voice',
        body: { schema: ChangeVoiceRequestSchema, value: request },
        responseSchema: MeResponseSchema,
      }),
    retry: false,
    // The keys of the person who started the save, taken when it starts: a re-render replaces
    // these options while the request is out, and a late answer must never be written under
    // another account's key.
    onMutate: () => {
      const me = meQueryKey(userId);
      const queue = queueQueryKey(userId);
      // The prefix of every cached topic list of the person.
      const topics = topicsUserKey(userId);
      return {
        me,
        staleOnSaved: [queue, topics],
        staleOnFailed: [me, queue, topics, voicesQueryKey],
      };
    },
    onSuccess: async (response, _request, keys) => {
      await applyPreferenceSaved(queryClient, keys.me, response, keys.staleOnSaved);
      callbacks.onSaved?.(response);
    },
    onError: (_error, _request, keys) => {
      if (keys) applyPreferenceSaveFailed(queryClient, keys.staleOnFailed);
      callbacks.onFailed?.();
    },
  });
}

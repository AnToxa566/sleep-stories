import {
  ChangeVoiceRequestSchema,
  MeResponseSchema,
  type ChangeVoiceRequest,
  type MeResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { voicesQueryKey } from '../../../api/catalogue/use-voices';
import { apiFetch } from '../../../api/http/api-fetch';
import { meQueryKey } from '../../../api/me/use-me';
import { queueQueryKey, topicsUserKey } from '../../../api/query-keys';
import { useSessionStore } from '../../auth/session/session-store';
import {
  applyPreferenceSaved,
  applyPreferenceSaveFailed,
  type PreferenceChangeKeys,
} from '../preference-change/preference-change-cache';

export const changeVoiceMutationKey = ['change-voice'] as const;

type ChangeVoiceCallbacks = {
  onSaved?: (response: MeResponse) => void;
  onFailed?: () => void;
};

// PUT /me/voice: changes only the narrator and answers with the new /me. It creates no job.
// Never retried by itself: the person presses the button again. What it does to the cache is in
// settings/preference-change/preference-change-cache.ts. Which stories are ready depends on the narrator,
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

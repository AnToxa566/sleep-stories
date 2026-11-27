import {
  ChangeInterestsRequestSchema,
  MeResponseSchema,
  type ChangeInterestsRequest,
  type MeResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../../features/auth/session/session-store';
import { apiFetch } from '../api-fetch';
import { interestsQueryKey, meQueryKey } from '../queries';
import { topicsUserKey } from '../query-keys';
import {
  applyPreferenceSaved,
  applyPreferenceSaveFailed,
  type PreferenceChangeKeys,
} from './preference-change-cache';

export const changeInterestsMutationKey = ['change-interests'] as const;

type ChangeInterestsCallbacks = {
  onSaved?: (response: MeResponse) => void;
  onFailed?: () => void;
};

// PUT /me/interests: replaces both interest lists and answers with the new /me. It creates no
// job and asks for no new topics. Never retried by itself: the person presses the button again.
// What it does to the cache is in preference-change-cache.ts. The new /me also feeds the count
// on «Настройки», the caption on «Сегодня» and the chips of the sheet «Подобрать темы». Which
// topics are listed depends on the interests, so a save makes the topic lists stale. The queue
// and the suggestion status are not read from the interests, so they are left alone. A failure
// reads the catalogue again too: a refused interest means it is out of date.
//
// `onSaved` and `onFailed` are in the hook's own options, so they run even when the screen was
// closed while the request was out; callbacks passed to `mutate` would not.
export function useChangeInterests(callbacks: ChangeInterestsCallbacks = {}) {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.userId);
  return useMutation<MeResponse, Error, ChangeInterestsRequest, PreferenceChangeKeys>({
    mutationKey: changeInterestsMutationKey,
    mutationFn: (request) =>
      apiFetch({
        method: 'PUT',
        path: '/me/interests',
        body: { schema: ChangeInterestsRequestSchema, value: request },
        responseSchema: MeResponseSchema,
      }),
    retry: false,
    // The keys of the person who started the save, taken when it starts: a re-render replaces
    // these options while the request is out, and a late answer must never be written under
    // another account's key.
    onMutate: () => {
      const me = meQueryKey(userId);
      // The prefix of every cached topic list of the person.
      const topics = topicsUserKey(userId);
      return {
        me,
        staleOnSaved: [topics],
        staleOnFailed: [me, topics, interestsQueryKey],
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

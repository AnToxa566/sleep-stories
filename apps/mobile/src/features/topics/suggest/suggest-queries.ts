import {
  SuggestTopicsRequestSchema,
  SuggestionStatusResponseSchema,
  type SuggestTopicsRequest,
  type SuggestionStatusResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../api/api-client';
import { apiFetch } from '../../../api/api-fetch';
import { strings } from '../../../strings';
import { useSessionStore } from '../../auth/session/session-store';
import { finishedSuggestion, isSuggesting } from './suggest-sheet';
import { topicsUserKey } from '../topic-data/topic-cache';

// «Подобрать новые темы» on «Темы» (ARCHITECTURE.md section 6, "Topics on request").
//
// COST: POST /topics/suggest starts one topic suggestion (a cheap model call, one of the 5 per
// rolling 24 hours). It never creates a story or audio job (AGENTS.md architecture rule 10).
// It is still a tap only: `start` is called from the sheet's button and nowhere else; nothing
// here calls it on mount, in an effect or in a poll. `queue-rule-10.spec.ts` keeps the path in
// this module and the «Темы» screen and components.

const POLL_MS = 4000;

export const suggestionQueryKey = (userId: string | null) => ['topicSuggestion', userId] as const;

export type TopicSuggestionCallbacks = {
  // The server accepted the start: the snackbar «Подбор запущен».
  onStarted: () => void;
  // The suggestion THIS phone started has ended: «Новые темы добавлены» or the error.
  onFinished: (result: 'succeeded' | 'failed') => void;
  // A start refused for a reason the screen does not already show: a short Russian message.
  onError: (message: string) => void;
};

// GET /topics/suggestion: the person's newest suggestion and what is left of the cap. Read on
// mount, each time the tab gains focus, and every 4 s while a suggestion runs (React Query
// pauses the timer while the app is in the background). It creates nothing.
function useSuggestionStatus() {
  const status = useSessionStore((state) => state.status);
  const userId = useSessionStore((state) => state.userId);
  const query = useQuery({
    queryKey: suggestionQueryKey(userId),
    queryFn: () =>
      apiFetch({
        method: 'GET',
        path: '/topics/suggestion',
        responseSchema: SuggestionStatusResponseSchema,
      }),
    enabled: status === 'signedIn' && userId !== null,
    refetchInterval: (q) => (isSuggesting(q.state.data) ? POLL_MS : false),
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return query;
}

// The state behind the three entry points and the sheet, and the start itself. The id of the
// suggestion this phone started lives here, in a screen that stays mounted (a tab): only that
// one ends in a snackbar. After an app restart the id is gone, so an old result shows nothing,
// while the buttons stay inactive as long as the server says a suggestion runs.
export function useTopicSuggestion(callbacks: TopicSuggestionCallbacks) {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.userId);
  const statusQuery = useSuggestionStatus();
  const [startedId, setStartedId] = useState<string | null>(null);

  const mutation = useMutation<SuggestionStatusResponse, unknown, SuggestTopicsRequest>({
    mutationFn: (request) =>
      apiFetch({
        method: 'POST',
        path: '/topics/suggest',
        body: { schema: SuggestTopicsRequestSchema, value: request },
        responseSchema: SuggestionStatusResponseSchema,
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(suggestionQueryKey(userId), response);
      setStartedId(response.latest?.id ?? null);
      callbacks.onStarted();
    },
    onError: (error) => {
      // 409: a suggestion already runs; 429: none left. The status read below makes the
      // buttons inactive or the caption say so; the cap is worth a word, the 409 is not.
      void queryClient.invalidateQueries({ queryKey: suggestionQueryKey(userId) });
      if (error instanceof ApiError && error.status === 409) return;
      callbacks.onError(
        error instanceof ApiError && error.status === 429
          ? strings.topics.suggest.limitReached
          : strings.topics.suggest.toasts.startFailed,
      );
    },
  });

  // The end of the started suggestion: read every topic list again and tell the screen. It
  // shows a snackbar and reads lists only; it starts nothing.
  const finished = finishedSuggestion(startedId, statusQuery.data);
  const { onFinished } = callbacks;
  useEffect(() => {
    if (finished === null) return;
    setStartedId(null);
    if (finished === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: topicsUserKey(userId) });
    }
    onFinished(finished);
  }, [finished, onFinished, queryClient, userId]);

  return {
    status: statusQuery.data,
    // Inactive while a suggestion runs or the start is on its way.
    suggesting: isSuggesting(statusQuery.data) || mutation.isPending,
    start: mutation.mutate,
  };
}

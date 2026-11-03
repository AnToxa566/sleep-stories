import {
  ContinueResponseSchema,
  ListenReportRequestSchema,
  ListenReportResponseSchema,
  QueueResponseSchema,
  type ContinueResponse,
} from '@sleep-stories/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/api-fetch';
import { useSessionStore } from '../auth/session-store';
import { queueQueryKey } from '../today/queue-cache';
import { topicsUserKey } from '../topics/topic-cache';
import { urlsByStoryId } from './player-stories';

// The three requests of the stories player. The pure parts are in player-stories.ts.
//
// `useContinueQueue` is the only place in the app that calls POST /queue/continue, and the
// player is the only code that may use it (queue-rule-10.spec.ts checks both). The route can
// start at most a topic suggestion on the server, never a story or an audio job.

// A report must never hold up the night: we stop waiting for it after this long.
export const LISTEN_REPORT_TIMEOUT_MS = 5000;

// POST /listens: one report per story, sent when the person leaves it. Never rejects. A failure
// loses one listen, which is better than blocking playback or a screen change; the log line is
// fixed and carries no id, number or text.
export async function postListenReport(storyId: string, listenedSec: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      apiFetch({
        method: 'POST',
        path: '/listens',
        body: { schema: ListenReportRequestSchema, value: { storyId, listenedSec } },
        responseSchema: ListenReportResponseSchema,
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), LISTEN_REPORT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    console.warn('Listen report failed');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// GET /queue for its signed URLs only: story id to URL. Signed URLs live 30 minutes and a night
// is hours, so the player reads them again before a story whose URL is old. Does not touch the
// query cache. Rejects when the queue cannot be read; the engine then plays the URL it holds.
export async function fetchFreshAudioUrls(): Promise<Map<string, string>> {
  const queue = await apiFetch({
    method: 'GET',
    path: '/queue',
    responseSchema: QueueResponseSchema,
  });
  return urlsByStoryId(queue.items);
}

// POST /queue/continue: the touch during the waves. The answer carries the new queue, which
// goes into the cache here so «Сегодня» is right whichever way the night ends. A queue poll that
// started earlier is cancelled first, so its older answer cannot overwrite this one. The topics
// lists follow the queue (`inQueue`), so they are read again.
export function useContinueQueue() {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.userId);
  return useMutation<ContinueResponse, unknown, void>({
    mutationFn: () =>
      apiFetch({
        method: 'POST',
        path: '/queue/continue',
        responseSchema: ContinueResponseSchema,
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queueQueryKey(userId) });
    },
    onSuccess: (response) => {
      queryClient.setQueryData(queueQueryKey(userId), response.queue);
      void queryClient.invalidateQueries({ queryKey: topicsUserKey(userId) });
    },
  });
}

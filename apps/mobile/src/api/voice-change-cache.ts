import type { MeResponse } from '@sleep-stories/contracts';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

// What a change of the narrator does to the cache. Pure, so it is tested with a real
// QueryClient; the keys are passed in, so the test loads no Expo code.

export type VoiceChangeKeys = {
  readonly me: QueryKey;
  readonly queue: QueryKey;
  // The prefix of every cached topic list of the person.
  readonly topics: QueryKey;
  readonly voices: QueryKey;
};

// The server saved the voice and answered with the new /me.
export async function applyVoiceSaved(
  queryClient: QueryClient,
  keys: VoiceChangeKeys,
  response: MeResponse,
): Promise<void> {
  // A read of /me that started before the save would bring the old voice back.
  await queryClient.cancelQueries({ queryKey: keys.me });
  queryClient.setQueryData<MeResponse>(keys.me, response);
  // Which stories are ready depends on the narrator, so the queue and the topic lists are read
  // again. Not awaited: the screen closes on the save, not on these reads. The voices do not
  // depend on the choice.
  void queryClient.invalidateQueries({ queryKey: keys.queue });
  void queryClient.invalidateQueries({ queryKey: keys.topics });
}

// The save failed, as far as the app knows. After a timeout the server may have saved all the
// same, so everything that depends on the narrator is read again; and a refused voice
// (`unknown_voice`) means the list of voices is out of date.
export function applyVoiceSaveFailed(queryClient: QueryClient, keys: VoiceChangeKeys): void {
  for (const queryKey of [keys.me, keys.queue, keys.topics, keys.voices]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

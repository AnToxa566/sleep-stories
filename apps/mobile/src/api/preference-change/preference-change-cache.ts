import type { MeResponse } from '@sleep-stories/contracts';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

// What a save of one of the person's preferences does to the cache. Pure, so it is tested
// with a real QueryClient; the keys are passed in, so the test loads no Expo code.

export type PreferenceChangeKeys = {
  readonly me: QueryKey;
  // What a saved change makes out of date, besides /me.
  readonly staleOnSaved: readonly QueryKey[];
  // What is read again after a failure, /me included.
  readonly staleOnFailed: readonly QueryKey[];
};

// The server saved the change and answered with the new /me.
export async function applyPreferenceSaved(
  queryClient: QueryClient,
  meKey: QueryKey,
  response: MeResponse,
  staleKeys: readonly QueryKey[],
): Promise<void> {
  // A read of /me that started before the save would bring the old value back.
  await queryClient.cancelQueries({ queryKey: meKey });
  queryClient.setQueryData<MeResponse>(meKey, response);
  // What depends on the preference is read again. Not awaited: the screen closes on the save,
  // not on these reads.
  for (const queryKey of staleKeys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

// The save failed, as far as the app knows. After a timeout the server may have saved all the
// same, so everything that depends on the preference is read again.
export function applyPreferenceSaveFailed(
  queryClient: QueryClient,
  keys: readonly QueryKey[],
): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

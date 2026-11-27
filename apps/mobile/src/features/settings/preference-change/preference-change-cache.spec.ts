import type { MeResponse } from '@sleep-stories/contracts';
import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { queueQueryKey, topicsUserKey } from '../../../api/query-keys';
import { applyPreferenceSaved, applyPreferenceSaveFailed } from './preference-change-cache';

// The keys of a change of the narrator.
const keys = {
  me: ['me', 'user-a'],
  queue: queueQueryKey('user-a'),
  topics: topicsUserKey('user-a'),
  voices: ['voices'],
};
const staleOnSaved: QueryKey[] = [keys.queue, keys.topics];
const staleOnFailed: QueryKey[] = [keys.me, keys.queue, keys.topics, keys.voices];
// Two cached lists under the topics prefix.
const topicLists: QueryKey[] = [
  [...keys.topics, 'all'],
  [...keys.topics, 'tale'],
];
const otherUser: QueryKey[] = [['me', 'user-b'], queueQueryKey('user-b'), topicsUserKey('user-b')];

function me(voiceSlug: string): MeResponse {
  return {
    onboardingCompleted: true,
    preferences: { voiceSlug, styles: ['facts'], interestSlugs: [], customInterests: [] },
  };
}

describe('preference change cache', () => {
  let queryClient: QueryClient;
  const invalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData(keys.me, me('anna'));
    for (const key of [keys.queue, ...topicLists, keys.voices, ...otherUser]) {
      queryClient.setQueryData(key, {});
    }
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('puts the answer into /me and marks the queue and every topic list stale', async () => {
    await applyPreferenceSaved(queryClient, keys.me, me('lev'), staleOnSaved);

    expect(queryClient.getQueryData(keys.me)).toEqual(me('lev'));
    expect(invalidated(keys.me)).toBe(false);
    expect(invalidated(keys.queue)).toBe(true);
    for (const key of topicLists) expect(invalidated(key)).toBe(true);
    expect(invalidated(keys.voices)).toBe(false);
    for (const key of otherUser) expect(invalidated(key)).toBe(false);
  });

  it('is not overwritten by a read of /me that started before the save', async () => {
    let answer: (value: MeResponse) => void = () => undefined;
    const oldRead = queryClient
      .fetchQuery({
        queryKey: keys.me,
        queryFn: () => new Promise<MeResponse>((resolve) => (answer = resolve)),
      })
      .catch(() => undefined);

    await applyPreferenceSaved(queryClient, keys.me, me('lev'), staleOnSaved);
    answer(me('anna'));
    await oldRead;

    expect(queryClient.getQueryData(keys.me)).toEqual(me('lev'));
  });

  it('reads the queue on screen again without waiting for the answer', async () => {
    const queryFn = jest.fn(() => new Promise<object>(() => undefined));
    const observer = new QueryObserver(queryClient, {
      queryKey: keys.queue,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    expect(queryFn).not.toHaveBeenCalled();

    // The read never answers, so this resolves only if it is not awaited.
    await applyPreferenceSaved(queryClient, keys.me, me('lev'), staleOnSaved);

    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('marks everything that depends on the preference stale after a failure', () => {
    applyPreferenceSaveFailed(queryClient, staleOnFailed);

    for (const key of [keys.me, keys.queue, ...topicLists, keys.voices]) {
      expect(invalidated(key)).toBe(true);
    }
    // The old data stays until the new answer comes: nothing is guessed.
    expect(queryClient.getQueryData(keys.me)).toEqual(me('anna'));
    for (const key of otherUser) expect(invalidated(key)).toBe(false);
  });
});

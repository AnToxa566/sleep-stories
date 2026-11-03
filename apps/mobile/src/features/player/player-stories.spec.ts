import type { QueueItem } from '@sleep-stories/contracts';
import { LISTEN_MIN_SEC } from '@sleep-stories/contracts';
import {
  listenSecondsToReport,
  readyStories,
  urlIsStale,
  urlsByStoryId,
  URL_MAX_AGE_MS,
  WAVES_FADE_START,
  wavesRingProgress,
  wavesSecondsLeft,
  wavesVolume,
  withFreshUrls,
  type PlayerStory,
} from './player-stories';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function ready(storyId: string, title: string, url: string): QueueItem {
  return {
    id: `${storyId.slice(0, 8)}-0000-4000-8000-000000000000`,
    topicId: '33333333-3333-4333-8333-333333333333',
    title,
    style: 'facts',
    state: 'ready',
    storyId,
    durationSec: 185,
    audioUrl: url,
  };
}

const waiting: QueueItem = {
  id: '44444444-4444-4444-8444-444444444444',
  topicId: '55555555-5555-4555-8555-555555555555',
  title: 'Not yet',
  style: 'history',
  state: 'not_ready',
};

describe('the snapshot of the night', () => {
  it('keeps only the ready items, in queue order', () => {
    const stories = readyStories(
      [ready(ID_A, 'A', 'https://a.test/a'), waiting, ready(ID_B, 'B', 'https://a.test/b')],
      1000,
    );
    expect(stories.map((story) => story.storyId)).toEqual([ID_A, ID_B]);
    expect(stories[0]).toMatchObject({ title: 'A', durationSec: 185, url: 'https://a.test/a', urlFetchedAt: 1000 });
  });

  it('is empty when nothing is ready', () => {
    expect(readyStories([waiting], 1)).toEqual([]);
  });
});

describe('the age of a signed URL', () => {
  const story: PlayerStory = {
    storyId: ID_A,
    title: 'A',
    style: 'facts',
    durationSec: 185,
    url: 'https://a.test/a',
    urlFetchedAt: 10_000,
  };

  it('is fresh before 20 minutes and stale from 20 minutes', () => {
    expect(urlIsStale(story, 10_000 + URL_MAX_AGE_MS - 1)).toBe(false);
    expect(urlIsStale(story, 10_000 + URL_MAX_AGE_MS)).toBe(true);
  });

  it('counts an unknown age as stale', () => {
    expect(urlIsStale({ ...story, urlFetchedAt: 0 }, 1)).toBe(true);
  });

  it('takes fresh URLs by story id and keeps the old URL of a story that is not in the answer', () => {
    const second = { ...story, storyId: ID_B, url: 'https://a.test/old-b' };
    const fresh = urlsByStoryId([ready(ID_A, 'A', 'https://a.test/new-a'), waiting]);
    const merged = withFreshUrls([story, second], fresh, 99);
    expect(merged[0]).toMatchObject({ url: 'https://a.test/new-a', urlFetchedAt: 99 });
    expect(merged[1]).toBe(second);
  });
});

describe('what a listen report says', () => {
  const story = { durationSec: 185 };

  it('rounds the position down to whole seconds', () => {
    expect(listenSecondsToReport(61.9, story, false)).toBe(61);
  });

  it('reports nothing below the minimum, and reports the minimum itself', () => {
    expect(listenSecondsToReport(LISTEN_MIN_SEC - 0.1, story, false)).toBeNull();
    expect(listenSecondsToReport(LISTEN_MIN_SEC, story, false)).toBe(LISTEN_MIN_SEC);
    expect(listenSecondsToReport(0, story, false)).toBeNull();
  });

  it('counts a story that played to its end as its full length', () => {
    expect(listenSecondsToReport(184.6, story, true)).toBe(185);
  });

  it('survives a position that is not a number', () => {
    expect(listenSecondsToReport(Number.NaN, story, false)).toBeNull();
    expect(listenSecondsToReport(Number.NaN, story, true)).toBe(185);
  });

  it('does not report a story that ended before the minimum even when finished', () => {
    expect(listenSecondsToReport(4, { durationSec: 5 }, true)).toBeNull();
  });
});

describe('the waves', () => {
  it('play at full volume at first and fade out to silence at the end', () => {
    expect(wavesVolume(0, 20)).toBe(1);
    expect(wavesVolume(20 * WAVES_FADE_START, 20)).toBe(1);
    expect(wavesVolume(20, 20)).toBe(0);
    const mid = wavesVolume(20 * ((1 + WAVES_FADE_START) / 2), 20);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });

  it('never fall outside 0 to 1, and fall back to the nominal length without a duration', () => {
    expect(wavesVolume(-5, 20)).toBe(1);
    expect(wavesVolume(99, 20)).toBe(0);
    expect(wavesVolume(20, 0)).toBe(0);
    expect(wavesVolume(10, Number.NaN)).toBeGreaterThan(0);
  });

  it('only get quieter as the position grows', () => {
    let previous = 1;
    for (let t = 0; t <= 20; t += 0.5) {
      const volume = wavesVolume(t, 20);
      expect(volume).toBeLessThanOrEqual(previous);
      previous = volume;
    }
  });

  it('count down whole seconds from 20 to 0', () => {
    expect(wavesSecondsLeft(0, 20)).toBe(20);
    expect(wavesSecondsLeft(0.2, 20)).toBe(20);
    expect(wavesSecondsLeft(0.9, 20)).toBe(20);
    expect(wavesSecondsLeft(1.1, 20)).toBe(19);
    expect(wavesSecondsLeft(19.5, 20)).toBe(1);
    expect(wavesSecondsLeft(20, 20)).toBe(0);
    expect(wavesSecondsLeft(40, 20)).toBe(0);
  });

  it('empty the ring from 0 to 1', () => {
    expect(wavesRingProgress(0, 20)).toBe(0);
    expect(wavesRingProgress(10, 20)).toBe(0.5);
    expect(wavesRingProgress(25, 20)).toBe(1);
  });
});

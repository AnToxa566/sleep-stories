import { toStoryState } from './story-state';
import type { StateRow } from './story-state';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const noStory: StateRow = {
  topic_id: id(1),
  story_id: null,
  duration_sec: null,
  storage_path: null,
  has_audio: false,
  active: false,
  newest_status: null,
};
const withStory: StateRow = { ...noStory, story_id: id(2) };
const withAudio: StateRow = {
  ...withStory,
  duration_sec: 600,
  storage_path: 'stories/x/anna.mp3',
  has_audio: true,
};

describe('toStoryState', () => {
  it('is ready when audio exists in the voice, with the duration and the path', () => {
    expect(toStoryState(withAudio)).toEqual({
      state: 'ready',
      storyId: id(2),
      durationSec: 600,
      storagePath: 'stories/x/anna.mp3',
    });
  });

  it('is ready even when a job is active or failed (audio wins)', () => {
    expect(toStoryState({ ...withAudio, active: true }).state).toBe('ready');
    expect(toStoryState({ ...withAudio, newest_status: 'failed' }).state).toBe('ready');
  });

  it('is creating when a job of the next stage is active', () => {
    expect(toStoryState({ ...noStory, active: true, newest_status: 'running' }).state).toBe('creating');
    expect(toStoryState({ ...withStory, active: true, newest_status: 'pending' }).state).toBe('creating');
  });

  it('is creating when an older job failed and a newer one is active', () => {
    expect(toStoryState({ ...withStory, active: true, newest_status: 'pending' }).state).toBe('creating');
  });

  it('is failed when no job is active and the newest one failed', () => {
    expect(toStoryState({ ...noStory, newest_status: 'failed' }).state).toBe('failed');
    expect(toStoryState({ ...withStory, newest_status: 'failed' })).toEqual({
      state: 'failed',
      storyId: id(2),
      durationSec: null,
      storagePath: null,
    });
  });

  it('is not_ready with no job, or when the newest job succeeded without audio', () => {
    expect(toStoryState(noStory).state).toBe('not_ready');
    expect(toStoryState({ ...withStory, newest_status: 'succeeded' }).state).toBe('not_ready');
  });

  it('never carries a path or a duration unless ready', () => {
    for (const row of [noStory, withStory, { ...withStory, active: true }, { ...withStory, newest_status: 'failed' }]) {
      const state = toStoryState(row);
      expect(state.storagePath).toBeNull();
      expect(state.durationSec).toBeNull();
    }
  });

  it('throws on a ready row that lacks its data', () => {
    expect(() => toStoryState({ ...withAudio, storage_path: null })).toThrow();
  });
});

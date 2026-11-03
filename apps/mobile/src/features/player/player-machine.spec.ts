import {
  initialPlayerState,
  isLastStory,
  nextStoryIndex,
  playerReducer,
  positionLabel,
  tapIntent,
  type PlayerEvent,
  type PlayerState,
} from './player-machine';

function run(state: PlayerState, ...events: PlayerEvent[]): PlayerState {
  return events.reduce(playerReducer, state);
}

const three = initialPlayerState(3);
const lastDim = run(three, { type: 'storyEnded' }, { type: 'storyEnded' }, { type: 'moon' });

describe('player machine: the start', () => {
  it('starts in the player view on the first story, playing', () => {
    expect(three).toEqual({ mode: 'playing', index: 0, count: 3, paused: false, continuing: false });
  });

  it('writes «N / M» from the snapshot', () => {
    expect(positionLabel(three)).toBe('1 / 3');
    expect(positionLabel(run(three, { type: 'storyEnded' }))).toBe('2 / 3');
  });

  it('shows the next-story card only when the current story is not the last', () => {
    expect(nextStoryIndex(three)).toBe(1);
    const last = run(three, { type: 'storyEnded' }, { type: 'storyEnded' });
    expect(isLastStory(last)).toBe(true);
    expect(nextStoryIndex(last)).toBeNull();
    expect(nextStoryIndex(initialPlayerState(1))).toBeNull();
  });
});

describe('player machine: dimming', () => {
  it('goes dim on the moon button and on idle, only from the player view', () => {
    expect(run(three, { type: 'moon' }).mode).toBe('dim');
    expect(run(three, { type: 'idle' }).mode).toBe('dim');
    expect(run(three, { type: 'moon' }, { type: 'idle' }).mode).toBe('dim');
    // A paused story does not dim by itself, the moon button still works, resuming allows it.
    expect(run(three, { type: 'togglePause' }, { type: 'idle' }).mode).toBe('playing');
    expect(run(three, { type: 'togglePause' }, { type: 'moon' }).mode).toBe('dim');
    expect(run(three, { type: 'togglePause' }, { type: 'togglePause' }, { type: 'idle' }).mode).toBe('dim');
  });

  it('comes back on a touch and does not pause playback', () => {
    const dim = run(three, { type: 'moon' });
    expect(tapIntent(dim)).toBe('undim');
    const back = run(dim, { type: 'touch' });
    expect(back.mode).toBe('playing');
    expect(back.paused).toBe(false);
  });

  it('keeps a pause across dimming', () => {
    const paused = run(three, { type: 'togglePause' });
    expect(paused.paused).toBe(true);
    expect(run(paused, { type: 'moon' }, { type: 'touch' }).paused).toBe(true);
  });

  it('ignores a touch event outside the dimmed look and a moon outside the player view', () => {
    expect(run(three, { type: 'touch' })).toBe(three);
    const waves = run(initialPlayerState(1), { type: 'storyEnded' });
    expect(run(waves, { type: 'moon' })).toBe(waves);
    expect(run(waves, { type: 'idle' })).toBe(waves);
  });
});

describe('player machine: pause', () => {
  it('toggles in the player view only', () => {
    expect(run(three, { type: 'togglePause' }).paused).toBe(true);
    expect(run(three, { type: 'togglePause' }, { type: 'togglePause' }).paused).toBe(false);
    const dim = run(three, { type: 'moon' });
    expect(run(dim, { type: 'togglePause' })).toBe(dim);
  });
});

describe('player machine: stories in a row', () => {
  it('moves to the next story when a story ends, also while dimmed', () => {
    expect(run(three, { type: 'storyEnded' }).index).toBe(1);
    const dim = run(three, { type: 'moon' }, { type: 'storyEnded' });
    expect(dim.index).toBe(1);
    expect(dim.mode).toBe('dim');
  });

  it('plays the next story after a pause when «Следующая» is pressed', () => {
    const next = run(three, { type: 'togglePause' }, { type: 'nextPressed' });
    expect(next.index).toBe(1);
    expect(next.paused).toBe(false);
  });

  it('ignores «Следующая» outside the player view', () => {
    const dim = run(three, { type: 'moon' });
    expect(run(dim, { type: 'nextPressed' })).toBe(dim);
  });

  it('starts the waves after the last story, or on «Следующая» on the last story', () => {
    const last = run(three, { type: 'storyEnded' }, { type: 'storyEnded' });
    expect(run(last, { type: 'storyEnded' }).mode).toBe('waves');
    expect(run(last, { type: 'nextPressed' }).mode).toBe('waves');
    expect(run(last, { type: 'nextPressed' }).index).toBe(2);
  });

  it('keeps the dimmed look when the stories end while dimmed', () => {
    expect(lastDim.mode).toBe('dim');
    expect(run(lastDim, { type: 'storyEnded' }).mode).toBe('waves-dim');
  });

  it('ignores a story event once the waves play', () => {
    const waves = run(initialPlayerState(1), { type: 'storyEnded' });
    expect(run(waves, { type: 'storyEnded' })).toBe(waves);
    expect(run(waves, { type: 'nextPressed' })).toBe(waves);
  });
});

describe('player machine: previous', () => {
  const three = initialPlayerState(3);
  const second = { ...three, index: 1 };

  it('moves to the previous story and clears the pause', () => {
    const paused = run(second, { type: 'togglePause' });
    expect(run(paused, { type: 'previousPressed' })).toMatchObject({ index: 0, paused: false, mode: 'playing' });
  });

  it('does nothing on the first story or outside the player view', () => {
    expect(run(three, { type: 'previousPressed' })).toBe(three);
    const dim = run(second, { type: 'moon' });
    expect(run(dim, { type: 'previousPressed' })).toBe(dim);
  });
});

describe('player machine: the waves and sleep', () => {
  const waves = run(initialPlayerState(2), { type: 'storyEnded' }, { type: 'storyEnded' });
  const wavesDim = run(initialPlayerState(1), { type: 'moon' }, { type: 'storyEnded' });

  it('falls asleep when the waves end with no touch, in both looks', () => {
    expect(waves.mode).toBe('waves');
    expect(wavesDim.mode).toBe('waves-dim');
    expect(run(waves, { type: 'wavesEnded' }).mode).toBe('asleep');
    expect(run(wavesDim, { type: 'wavesEnded' }).mode).toBe('asleep');
  });

  it('ignores the end of the waves outside the waves', () => {
    expect(run(three, { type: 'wavesEnded' })).toBe(three);
  });

  it('reads a touch as «continue» on 3c only', () => {
    expect(tapIntent(waves)).toBe('continue');
    expect(tapIntent(wavesDim)).toBe('undim');
  });

  it('shows 3c on a touch during the dimmed waves, without continuing or restarting anything', () => {
    const shown = run(wavesDim, { type: 'touch' });
    expect(shown).toEqual({ ...wavesDim, mode: 'waves' });
    expect(shown.continuing).toBe(false);
    expect(tapIntent(shown)).toBe('continue');
  });

  it('falls asleep when the waves end after the dimmed look was left', () => {
    expect(run(wavesDim, { type: 'touch' }, { type: 'wavesEnded' }).mode).toBe('asleep');
  });

  it('reads a touch on the asleep screen as waking up', () => {
    expect(tapIntent(run(waves, { type: 'wavesEnded' }))).toBe('wake');
  });

  it('reads a touch in the player view as nothing (the controls handle their own)', () => {
    expect(tapIntent(three)).toBe('none');
  });

  it('waits for the answer when the waves end during the request', () => {
    const waiting = run(waves, { type: 'continueStarted' });
    expect(tapIntent(waiting)).toBe('none');
    const ended = run(waiting, { type: 'wavesEnded' });
    expect(ended.mode).toBe('waves');
    expect(ended.continuing).toBe(true);
  });

  it('goes back to the player view from the first story when stories were found', () => {
    const found = run(waves, { type: 'continueStarted' }, { type: 'continueReady', count: 4 });
    expect(found).toEqual({ mode: 'playing', index: 0, count: 4, paused: false, continuing: false });
  });

  it('ignores a continue answer that nobody asked for, and an empty one', () => {
    expect(run(waves, { type: 'continueReady', count: 2 })).toBe(waves);
    const waiting = run(waves, { type: 'continueStarted' });
    expect(run(waiting, { type: 'continueReady', count: 0 })).toBe(waiting);
  });

  it('allows another touch after a failed request', () => {
    const failed = run(waves, { type: 'continueStarted' }, { type: 'continueFailed' });
    expect(failed.continuing).toBe(false);
    expect(tapIntent(failed)).toBe('continue');
  });

  it('does not start a request outside the waves', () => {
    expect(run(three, { type: 'continueStarted' })).toBe(three);
  });

  it('gives up into the asleep look from anywhere', () => {
    expect(run(three, { type: 'giveUp' }).mode).toBe('asleep');
    expect(run(waves, { type: 'continueStarted' }, { type: 'giveUp' })).toMatchObject({
      mode: 'asleep',
      continuing: false,
    });
  });
});

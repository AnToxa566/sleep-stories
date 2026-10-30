import {
  initialSampleState,
  sampleReducer,
  tapIntent,
  type SampleState,
} from './voice-sample-state';

describe('sampleReducer', () => {
  it('starts a voice', () => {
    expect(sampleReducer(initialSampleState, { type: 'start', slug: 'anna' })).toEqual({
      slug: 'anna',
      failed: false,
    });
  });

  it('plays one sample at a time: starting another voice replaces the current one', () => {
    const playing: SampleState = { slug: 'anna', failed: false };
    expect(sampleReducer(playing, { type: 'start', slug: 'lev' }).slug).toBe('lev');
  });

  it('clears an old failure when a new sample starts', () => {
    const failed: SampleState = { slug: null, failed: true };
    expect(sampleReducer(failed, { type: 'start', slug: 'anna' }).failed).toBe(false);
  });

  it('stops and clears a failure on stop', () => {
    expect(sampleReducer({ slug: 'anna', failed: false }, { type: 'stop' })).toEqual(
      initialSampleState,
    );
    expect(sampleReducer({ slug: null, failed: true }, { type: 'stop' })).toEqual(
      initialSampleState,
    );
  });

  it('returns the same object when a stop changes nothing', () => {
    expect(sampleReducer(initialSampleState, { type: 'stop' })).toBe(initialSampleState);
  });

  it('resets the row when the file ends', () => {
    expect(sampleReducer({ slug: 'anna', failed: false }, { type: 'finished' })).toEqual(
      initialSampleState,
    );
  });

  it('ignores a late finish while nothing plays, and keeps a shown failure', () => {
    const failed: SampleState = { slug: null, failed: true };
    expect(sampleReducer(failed, { type: 'finished' })).toBe(failed);
  });

  it('resets the row and records the failure on an error', () => {
    expect(sampleReducer({ slug: 'anna', failed: false }, { type: 'error' })).toEqual({
      slug: null,
      failed: true,
    });
  });
});

describe('tapIntent', () => {
  it('stops the voice that is playing', () => {
    expect(tapIntent({ slug: 'anna', failed: false }, 'anna')).toBe('stop');
  });

  it('plays an idle voice, and a different voice while another plays', () => {
    expect(tapIntent(initialSampleState, 'anna')).toBe('play');
    expect(tapIntent({ slug: 'anna', failed: false }, 'lev')).toBe('play');
  });
});

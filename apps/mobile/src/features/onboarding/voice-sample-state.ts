// Pure state of the voice-sample player on the voice step. The Expo-backed part
// (useVoiceSample.ts) feeds it events; nothing here touches audio, so it is unit-tested.
//
// One sample at a time: `slug` is the voice being played, or null. `failed` keeps the last
// playback failure until the next tap, so the screen can show one short error line.
export type SampleState = {
  slug: string | null;
  failed: boolean;
};

export type SampleAction =
  { type: 'start'; slug: string } | { type: 'stop' } | { type: 'finished' } | { type: 'error' };

export const initialSampleState: SampleState = { slug: null, failed: false };

export function sampleReducer(state: SampleState, action: SampleAction): SampleState {
  switch (action.type) {
    case 'start':
      // Starting another voice replaces the current one and clears an old failure.
      return { slug: action.slug, failed: false };
    case 'stop':
      // A stop (a tap on the playing voice, a screen change, the app going to background)
      // is not a failure and clears an old one.
      return state.slug === null && !state.failed ? state : initialSampleState;
    case 'finished':
      // The end of the file resets the row. A late event while nothing plays changes nothing.
      return state.slug === null ? state : { slug: null, failed: state.failed };
    case 'error':
      return { slug: null, failed: true };
  }
}

// What a tap on a voice's play control should do: stop the voice that is playing, or start it.
export function tapIntent(state: SampleState, slug: string): 'stop' | 'play' {
  return state.slug === slug ? 'stop' : 'play';
}

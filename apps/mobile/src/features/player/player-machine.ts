// The state machine of the stories player (design frames 3a to 3d). Pure: no React Native, no
// audio, no timers. The engine (night-engine.ts) owns the players and the requests and feeds
// the machine the events that come from the person and from native playback; the machine only
// says which of the five looks the screen has and which story it is on.
//
// - playing:   3a, the player with its controls.
// - dim:       3b, the interface goes near-black; playback goes on.
// - waves:     3c, the last story ended and the bundled waves sound plays; a touch continues.
// - waves-dim: the same moment, but the person was in the dimmed look when the stories ended.
//              The player view does not appear; the look stays dimmed. A touch leaves the dimmed
//              look and shows 3c (the waves go on); it does not continue the stories.
// - asleep:    3d, the waves ended and nobody touched the screen.

export type PlayerMode = 'playing' | 'dim' | 'waves' | 'waves-dim' | 'asleep';

export type PlayerState = {
  readonly mode: PlayerMode;
  // 0-based index of the current story in the snapshot. Stays on the last story during the waves.
  readonly index: number;
  // Size of the snapshot ("M" of "N / M").
  readonly count: number;
  // The person paused the story (the play/pause button). Never set during the waves.
  readonly paused: boolean;
  // POST /queue/continue is in flight (a touch during the waves).
  readonly continuing: boolean;
};

export type PlayerEvent =
  // The moon button in the header.
  | { readonly type: 'moon' }
  // No touch for a while while the screen is on (a JS timer in the hook; see IDLE_DIM_MS).
  | { readonly type: 'idle' }
  // A touch on the dimmed look: back to the player (or to 3c during the waves); playback is not
  // paused and nothing is continued.
  | { readonly type: 'touch' }
  | { readonly type: 'togglePause' }
  // The story was paused or resumed outside the app (the lock screen, headphones, audio focus).
  // Not a button press: the engine already sees the native player in that state.
  | { readonly type: 'nativePaused' }
  | { readonly type: 'nativePlayed' }
  // The story played to its end (a native event).
  | { readonly type: 'storyEnded' }
  // «Следующая». The state changes exactly as when the story ends.
  | { readonly type: 'nextPressed' }
  // «Предыдущая» when it goes to the previous story (the restart of the same story is not a
  // state change). Ignored on the first story.
  | { readonly type: 'previousPressed' }
  // The waves file played to its end (a native event).
  | { readonly type: 'wavesEnded' }
  | { readonly type: 'continueStarted' }
  // The server found ready, unheard stories: the player starts again from the first.
  | { readonly type: 'continueReady'; readonly count: number }
  | { readonly type: 'continueFailed' }
  // Playback could not go on: the night ends quietly (asleep releases the screen).
  | { readonly type: 'giveUp' };

export function initialPlayerState(count: number): PlayerState {
  return { mode: 'playing', index: 0, count, paused: false, continuing: false };
}

export function isLastStory(state: PlayerState): boolean {
  return state.index >= state.count - 1;
}

// The story shown on the «Дальше» card, or null on the last story (the card is not shown).
export function nextStoryIndex(state: PlayerState): number | null {
  return isLastStory(state) ? null : state.index + 1;
}

export function isWaves(state: PlayerState): boolean {
  return state.mode === 'waves' || state.mode === 'waves-dim';
}

// «N / M» of the header.
export function positionLabel(state: PlayerState): string {
  return `${state.index + 1} / ${state.count}`;
}

// What a touch anywhere on the screen means in this state. The controls of the player view
// handle their own presses: a touch there is 'none'.
export type TapIntent = 'none' | 'undim' | 'continue' | 'wake';

export function tapIntent(state: PlayerState): TapIntent {
  switch (state.mode) {
    case 'dim':
    case 'waves-dim':
      return 'undim';
    case 'waves':
      return state.continuing ? 'none' : 'continue';
    case 'asleep':
      return 'wake';
    case 'playing':
      return 'none';
  }
}

// A story is over (it ended, or «Следующая» was pressed): the next one, or the waves after the last.
function advance(state: PlayerState): PlayerState {
  if (state.mode !== 'playing' && state.mode !== 'dim') return state;
  if (!isLastStory(state)) return { ...state, index: state.index + 1, paused: false };
  return { ...state, mode: state.mode === 'dim' ? 'waves-dim' : 'waves', paused: false };
}

export function playerReducer(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case 'moon':
      return state.mode === 'playing' ? { ...state, mode: 'dim' } : state;
    case 'idle':
      // Nobody is falling asleep to a paused story: the interface does not dim by itself then.
      return state.mode === 'playing' && !state.paused ? { ...state, mode: 'dim' } : state;
    case 'touch':
      // Leaving the dimmed look never pauses or continues anything. During the dimmed waves it
      // shows 3c; only a touch on 3c (`waves`) continues the stories.
      if (state.mode === 'dim') return { ...state, mode: 'playing' };
      if (state.mode === 'waves-dim') return { ...state, mode: 'waves' };
      return state;
    case 'togglePause':
      return state.mode === 'playing' ? { ...state, paused: !state.paused } : state;
    case 'nativePaused':
      // A paused story does not dim: when the dimmed look was on, the player view comes back, so
      // the person who unlocks the phone sees the paused story and its play button.
      return state.mode === 'playing' || state.mode === 'dim'
        ? { ...state, mode: 'playing', paused: true }
        : state;
    case 'nativePlayed':
      return state.mode === 'playing' || state.mode === 'dim' ? { ...state, paused: false } : state;
    case 'storyEnded':
      return advance(state);
    case 'nextPressed':
      // The button exists only in the player view; a late press in another look is ignored.
      return state.mode === 'playing' ? advance(state) : state;
    case 'previousPressed':
      if (state.mode !== 'playing' || state.index === 0) return state;
      return { ...state, index: state.index - 1, paused: false };
    case 'wavesEnded':
      // While the request is in flight the answer decides, not the end of the file.
      if (!isWaves(state) || state.continuing) return state;
      return { ...state, mode: 'asleep' };
    case 'continueStarted':
      return isWaves(state) ? { ...state, continuing: true } : state;
    case 'continueReady':
      if (!state.continuing || event.count < 1) return state;
      return { mode: 'playing', index: 0, count: event.count, paused: false, continuing: false };
    case 'continueFailed':
      return state.continuing ? { ...state, continuing: false } : state;
    case 'giveUp':
      return { ...state, mode: 'asleep', continuing: false };
  }
}

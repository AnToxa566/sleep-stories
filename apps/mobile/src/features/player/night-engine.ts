import type { ContinueResponse } from '@sleep-stories/contracts';
import {
  initialPlayerState,
  isWaves,
  playerReducer,
  tapIntent,
  type PlayerEvent,
  type PlayerState,
} from './player-machine';
import {
  listenSecondsToReport,
  readyStories,
  urlIsStale,
  WAVES_NOMINAL_SEC,
  wavesRingProgress,
  wavesSecondsLeft,
  wavesVolume,
  withFreshUrls,
  type PlayerStory,
} from './player-stories';

// The engine of one night in the player: it owns the audio players, feeds the pure machine
// (player-machine.ts) with what the person does and what native playback reports, reports the
// listens and asks the server to continue. It has no React and no expo-audio import: the
// players, the requests and the clock come in through `NightDeps`, so the whole flow is tested
// with fakes (night-engine.spec.ts) and the hook (use-night-session.ts) only wires the real ones.
//
// TIMING. The end of a story, the fade of the waves and the countdown come only from native
// playback status events, never from setTimeout or setInterval: on Android JavaScript timers do
// not fire while the app is in the background, native events do (ARCHITECTURE.md section 7).
// The one timer in the player (the idle dimming) lives in the hook and matters only while the
// screen is on.
//
// ONE PLAYER PER STORY, chained: the next story's player is created when the previous one has
// ended and the old one is removed. Cost: a short gap (the time to open the next stream) between
// stories; buying a gapless join would mean pre-loading, which this first version leaves out.

// The part of expo-audio's AudioStatus the engine reads. The real player's status has more fields.
export interface PlayerStatusLike {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly didJustFinish: boolean;
  readonly error: string | null;
}

// The part of expo-audio's AudioPlayer the engine uses.
export interface AudioPlayerLike {
  volume: number;
  readonly currentTime: number;
  play(): void;
  pause(): void;
  remove(): void;
  seekTo(seconds: number): Promise<void>;
  addListener(
    eventName: 'playbackStatusUpdate',
    listener: (status: PlayerStatusLike) => void,
  ): { remove(): void };
}

// How the night ended, for the screen to navigate.
export type NightExit = 'leave' | 'woke' | 'none-ready' | 'error';

export interface NightDeps {
  createStoryPlayer(url: string): AudioPlayerLike;
  createWavesPlayer(): AudioPlayerLike;
  // POST /api/listens. Must never reject and must not wait long (the caller times it out).
  reportListen(storyId: string, listenedSec: number): Promise<void>;
  // GET /api/queue: signed URLs by story id, or null when the queue could not be read.
  fetchFreshUrls(): Promise<ReadonlyMap<string, string> | null>;
  // POST /api/queue/continue. Rejects when the request fails.
  continueNight(): Promise<ContinueResponse>;
  now(): number;
  onExit(exit: NightExit): void;
}

export type NightView = {
  readonly state: PlayerState;
  readonly stories: readonly PlayerStory[];
  // Position in the current story, seconds.
  readonly positionSec: number;
  // The ring and the number of design 3c.
  readonly wavesLeftSec: number;
  readonly wavesProgress: number;
};

// A story that fails twice (the second time after a fresh URL) is skipped; after this many
// failures in a row the night ends quietly instead of skipping through the whole queue.
const MAX_FAILURES_IN_A_ROW = 2;

// A story that has played this many seconds past where it (re)started has really recovered, so
// the next error may be retried again. The first `playing` event is not enough: a dead URL can
// report it before failing, and that would loop forever.
export const RECOVERY_PROGRESS_SEC = 5;

// Requests the engine makes (the queue read for fresh URLs, the continue call) give up after
// this long, so a stalled network cannot hold the night. The timer is a JS timer: it matters
// only while the screen is on, and a request that outlives it is simply dropped.
export const REQUEST_TIMEOUT_MS = 15_000;

export class NightEngine {
  private stories: PlayerStory[];
  private state: PlayerState;
  private view: NightView;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  private storyPlayer: AudioPlayerLike | null = null;
  private storySubscription: { remove(): void } | null = null;
  private wavesPlayer: AudioPlayerLike | null = null;
  private wavesSubscription: { remove(): void } | null = null;
  // Each grows whenever its player is replaced or released, so a late event or a late answer
  // from a player that is gone changes nothing.
  private storyToken = 0;
  private wavesToken = 0;

  private position = 0;
  private reported = false;
  private retried = false;
  // Where the current player started from (0, or the resume position of a retry).
  private progressFrom = 0;
  private failures = 0;
  private wavesLeft = WAVES_NOMINAL_SEC;
  private wavesProgress = 0;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly deps: NightDeps,
    stories: readonly PlayerStory[],
  ) {
    this.stories = [...stories];
    this.state = initialPlayerState(stories.length);
    this.view = this.buildView();
  }

  // For useSyncExternalStore.
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getView = (): NightView => this.view;

  // Resolves when every listen report sent so far has finished (or failed). The screen reads
  // the queue again after it, since a recorded listen takes the item out of the queue.
  whenReportsSettled(): Promise<void> {
    return Promise.allSettled([...this.pending]).then(() => undefined);
  }

  start(): Promise<void> {
    return this.beginStory(0);
  }

  // ----- the person -----

  togglePause(): void {
    if (this.state.mode !== 'playing') return;
    this.send({ type: 'togglePause' });
    const player = this.storyPlayer;
    if (player === null) return;
    try {
      if (this.state.paused) player.pause();
      else player.play();
    } catch {
      // The player may be gone; the next status event or the next story sorts it out.
    }
  }

  // «Предыдущая» restarts the current story. It reports nothing: the story is not left.
  pressPrevious(): void {
    if (this.state.mode !== 'playing') return;
    this.position = 0;
    try {
      void this.storyPlayer?.seekTo(0).catch(() => undefined);
    } catch {
      // See togglePause.
    }
    this.emit();
  }

  // «Следующая». On the last story it starts the waves.
  pressNext(): void {
    if (this.state.mode !== 'playing') return;
    this.reportCurrent(false);
    this.releaseStoryPlayer();
    this.send({ type: 'nextPressed' });
    this.afterAdvance();
  }

  moon(): void {
    this.send({ type: 'moon' });
  }

  idle(): void {
    this.send({ type: 'idle' });
  }

  // A touch on the full-screen layers (the dimmed look, the waves, the asleep screen).
  touch(): void {
    if (this.disposed) return;
    switch (tapIntent(this.state)) {
      case 'undim':
        this.send({ type: 'touch' });
        return;
      case 'continue':
        void this.continueFromWaves();
        return;
      case 'wake':
        this.finish('woke');
        return;
      case 'none':
        return;
    }
  }

  // The arrow and the Android back key: stop everything and report the story being left.
  leave(): void {
    if (this.disposed) return;
    this.reportCurrent(false);
    this.finish('leave');
  }

  // The screen is gone (unmount): stop everything, say nothing.
  dispose(): void {
    if (this.disposed) return;
    this.reportCurrent(false);
    this.disposed = true;
    this.stopAudio();
  }

  // ----- stories -----

  private beginStory(index: number): Promise<void> {
    this.retried = false;
    this.position = 0;
    this.reported = false;
    return this.loadStory(index, 0);
  }

  private async loadStory(index: number, resumeAtSec: number): Promise<void> {
    this.releaseStoryPlayer();
    this.progressFrom = resumeAtSec;
    const token = this.storyToken;
    let story = this.stories[index];
    if (story === undefined) return;

    if (urlIsStale(story, this.deps.now())) {
      const fresh = await this.fetchFreshUrls();
      if (this.disposed || token !== this.storyToken) return;
      if (fresh !== null) {
        this.stories = withFreshUrls(this.stories, fresh, this.deps.now());
        story = this.stories[index] ?? story;
        this.emit();
      }
    }

    try {
      const player = this.deps.createStoryPlayer(story.url);
      this.storyPlayer = player;
      this.storySubscription = player.addListener('playbackStatusUpdate', (status) =>
        this.onStoryStatus(token, status),
      );
      if (resumeAtSec > 0) void player.seekTo(resumeAtSec).catch(() => undefined);
      if (!this.state.paused) player.play();
    } catch {
      void this.onStoryError(token);
    }
  }

  private async fetchFreshUrls(): Promise<ReadonlyMap<string, string> | null> {
    try {
      return await withTimeout(this.deps.fetchFreshUrls(), REQUEST_TIMEOUT_MS);
    } catch {
      return null;
    }
  }

  private onStoryStatus(token: number, status: PlayerStatusLike): void {
    if (this.disposed || token !== this.storyToken) return;
    if (status.error) {
      void this.onStoryError(token);
      return;
    }
    if (Number.isFinite(status.currentTime)) this.position = status.currentTime;
    if (status.didJustFinish) {
      this.finishStory();
      return;
    }
    if (status.playing) this.failures = 0;
    // Real progress after a retry re-arms the retry for the next error.
    if (this.retried && this.position >= this.progressFrom + RECOVERY_PROGRESS_SEC) {
      this.retried = false;
    }
    this.emit();
  }

  private finishStory(): void {
    if (this.state.mode !== 'playing' && this.state.mode !== 'dim') return;
    this.reportCurrent(true);
    this.releaseStoryPlayer();
    this.send({ type: 'storyEnded' });
    this.afterAdvance();
  }

  // After the machine moved on from a story: the next story, or the waves after the last one.
  private afterAdvance(): void {
    if (isWaves(this.state)) this.startWaves();
    else void this.beginStory(this.state.index);
  }

  private async onStoryError(token: number): Promise<void> {
    if (this.disposed || token !== this.storyToken) return;
    if (this.state.mode !== 'playing' && this.state.mode !== 'dim') return;
    const index = this.state.index;
    const resumeAt = this.position;
    this.releaseStoryPlayer();

    if (!this.retried) {
      // The usual cause is an expired signed URL: read the queue again and try the same story.
      this.retried = true;
      this.stories = this.stories.map((story, i) => (i === index ? { ...story, urlFetchedAt: 0 } : story));
      await this.loadStory(index, resumeAt);
      return;
    }

    this.failures += 1;
    if (this.failures >= MAX_FAILURES_IN_A_ROW) {
      // What was heard still counts: report it before the night ends.
      this.reportCurrent(false);
      this.stopAudio();
      this.send({ type: 'giveUp' });
      return;
    }
    // Skip the story that cannot be played. The part already heard is reported (the normal rule
    // drops a listen below the minimum), so a story heard to 90% does not stay unheard.
    this.reportCurrent(false);
    this.send({ type: 'storyEnded' });
    this.afterAdvance();
  }

  // One report per story, when the person leaves it. Short listens and failures are dropped
  // by the caller of the API; the position is read from the live player when there is one.
  private reportCurrent(finished: boolean): void {
    if (this.reported) return;
    const story = this.stories[this.state.index];
    if (story === undefined) return;
    this.reported = true;

    let position = this.position;
    if (!finished && this.storyPlayer !== null) {
      try {
        position = Math.max(position, this.storyPlayer.currentTime);
      } catch {
        // Keep the last position the status events gave.
      }
    }
    const seconds = listenSecondsToReport(position, story, finished);
    if (seconds === null) return;

    const task: Promise<void> = this.deps
      .reportListen(story.storyId, seconds)
      .catch(() => undefined)
      .then(() => {
        this.pending.delete(task);
      });
    this.pending.add(task);
  }

  // ----- the waves -----

  private startWaves(): void {
    this.releaseWaves();
    this.wavesLeft = WAVES_NOMINAL_SEC;
    this.wavesProgress = 0;
    const token = this.wavesToken;
    try {
      const player = this.deps.createWavesPlayer();
      this.wavesPlayer = player;
      this.wavesSubscription = player.addListener('playbackStatusUpdate', (status) =>
        this.onWavesStatus(token, status),
      );
      player.volume = 1;
      player.play();
    } catch {
      // No waves: the night goes on to sleep.
      this.finishWaves();
    }
    this.emit();
  }

  private onWavesStatus(token: number, status: PlayerStatusLike): void {
    if (this.disposed || token !== this.wavesToken || this.wavesPlayer === null) return;
    if (status.error) {
      this.finishWaves();
      return;
    }
    const duration = status.duration > 0 ? status.duration : WAVES_NOMINAL_SEC;
    // The fade is a function of the native position, so it follows the sound even with the
    // screen off.
    try {
      this.wavesPlayer.volume = wavesVolume(status.currentTime, duration);
    } catch {
      // The player is going away.
    }
    if (status.didJustFinish) {
      this.wavesLeft = 0;
      this.wavesProgress = 1;
      this.finishWaves();
      return;
    }
    this.wavesLeft = wavesSecondsLeft(status.currentTime, duration);
    this.wavesProgress = wavesRingProgress(status.currentTime, duration);
    this.emit();
  }

  private finishWaves(): void {
    this.releaseWaves();
    this.send({ type: 'wavesEnded' });
    this.emit();
  }

  // A touch during the waves: ask the server for more ready stories.
  private async continueFromWaves(): Promise<void> {
    if (!isWaves(this.state) || this.state.continuing) return;
    this.send({ type: 'continueStarted' });
    // The listen of the last story must have reached the server before it looks for unheard ones.
    await this.whenReportsSettled();
    if (this.disposed) return;

    let response: ContinueResponse;
    try {
      response = await withTimeout(this.deps.continueNight(), REQUEST_TIMEOUT_MS);
    } catch {
      if (this.disposed) return;
      this.send({ type: 'continueFailed' });
      this.finish('error');
      return;
    }
    if (this.disposed) return;

    const stories = readyStories(response.queue.items, this.deps.now());
    if (response.outcome === 'ready' && stories.length > 0) {
      this.releaseWaves();
      this.stories = stories;
      this.failures = 0;
      this.send({ type: 'continueReady', count: stories.length });
      void this.beginStory(0);
      return;
    }
    this.send({ type: 'continueFailed' });
    this.finish('none-ready');
  }

  // ----- the end -----

  private finish(exit: NightExit): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAudio();
    this.deps.onExit(exit);
  }

  private stopAudio(): void {
    this.releaseStoryPlayer();
    this.releaseWaves();
  }

  private releaseStoryPlayer(): void {
    this.storyToken += 1;
    release(this.storyPlayer, this.storySubscription);
    this.storyPlayer = null;
    this.storySubscription = null;
  }

  private releaseWaves(): void {
    this.wavesToken += 1;
    release(this.wavesPlayer, this.wavesSubscription);
    this.wavesPlayer = null;
    this.wavesSubscription = null;
  }

  private send(event: PlayerEvent): void {
    const next = playerReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    this.emit();
  }

  private buildView(): NightView {
    return {
      state: this.state,
      stories: this.stories,
      positionSec: this.position,
      wavesLeftSec: this.wavesLeft,
      wavesProgress: this.wavesProgress,
    };
  }

  private emit(): void {
    this.view = this.buildView();
    for (const listener of [...this.listeners]) listener();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function release(player: AudioPlayerLike | null, subscription: { remove(): void } | null): void {
  try {
    subscription?.remove();
  } catch {
    // Already removed.
  }
  if (player === null) return;
  try {
    player.pause();
  } catch {
    // Already released.
  }
  try {
    player.remove();
  } catch {
    // Already released.
  }
}

import type { ContinueResponse } from '@sleep-stories/contracts';
import {
  initialPlayerState,
  isLastStory,
  isWaves,
  playerReducer,
  tapIntent,
  type PlayerEvent,
  type PlayerState,
} from './player-machine';
import {
  clampSeekTarget,
  effectiveDuration,
  listenSecondsToReport,
  previousIntent,
  readyStories,
  storyProgress,
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
// ended and the old one is removed, after a pause of silence (below).
//
// THE PAUSES. Three seconds of silence follow a story that ended by itself, so that two stories do
// not run into each other, and three seconds follow the last story before the waves (owner,
// 2026-11-03). The silence is a bundled silent file played by its own player (`createSilencePlayer`)
// and its native `didJustFinish` starts the next thing. Why not a timer: a phone locked by the
// person must still go on to the next story, and JavaScript timers do not fire in the background
// on Android while native player events do. Cost: one more short-lived native player per pause,
// and the pause is as long as the file (SILENCE_FILE_SEC). «Следующая» and «Предыдущая» skip the
// pause between stories (the person asked for the move); «Следующая» on the last story takes the
// same pause before the waves as the end of the last story does.
//
// THE LOCK SCREEN. Each story player is made the active lock-screen player (play/pause and the
// scrub bar of the system media control; ARCHITECTURE.md section 7, "The lock screen"). The
// silence of a pause and the waves are not: their controls would show a stale title, and the
// control disappears while a story player is released (expo-audio unregisters the active player
// on release; `clearLockScreenControls` is called first to be explicit). What the person does
// there arrives as ordinary native playback status events, so no separate channel exists:
//   - a pause or play on the lock screen shows up as `playing` changing with no command of ours
//     behind it; the engine then tells the machine (`nativePaused` / `nativePlayed`) so that the
//     in-app button and the idle dimming follow. `expectPlaying` is the command we issued and
//     have not seen acknowledged yet: until the native state agrees with it, contradicting
//     events are the old state, not the person (no feedback loop with the in-app button).
//     Buffering, a seek in flight, the end of the story and the start of a stream are not pauses.
//   - a scrub on the lock screen shows up as a position jump that no `seekTo` of ours explains:
//     the position follows it, and `progressFrom` moves to it so the jump is not counted as
//     playback progress by the retry re-arming.
//
// In the pause between stories the machine still shows the story that ended (its bar full); the
// index moves on when the next story actually starts. In the pause before the waves the machine
// is already in `waves`, and the countdown keeps its full length until the waves audio starts.

// The part of expo-audio's AudioStatus the engine reads. The real player's status has more fields.
export interface PlayerStatusLike {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly didJustFinish: boolean;
  readonly error: string | null;
  // True while the stream stalls or a seek is loading. `playing` is false then on iOS, which is
  // not a pause by the person. Absent in older fakes: treated as false.
  readonly isBuffering?: boolean;
}

// The metadata of the system media control: the story title and the app name, never story text.
export interface LockScreenMetadata {
  readonly title: string;
  readonly artist: string;
  // A file:// or http(s) address of the picture on the media control. Optional: without it the
  // system draws its own placeholder.
  readonly artworkUrl?: string;
}

// The options of expo-audio's setActiveForLockScreen. Play/pause and the scrub bar are always
// there; these two add skip buttons. Both keys are always sent: on Android the native record
// requires them.
export interface LockScreenOptions {
  readonly showSeekForward: boolean;
  readonly showSeekBackward: boolean;
}

// The part of expo-audio's AudioPlayer the engine uses.
export interface AudioPlayerLike {
  volume: number;
  readonly currentTime: number;
  play(): void;
  pause(): void;
  remove(): void;
  seekTo(seconds: number): Promise<void>;
  // The lock-screen control. Only the player of a story has it set up; the others (silence,
  // waves) do not implement it as far as the engine is concerned.
  setActiveForLockScreen?(
    active: boolean,
    metadata?: { title?: string; artist?: string },
    options?: { showSeekForward?: boolean; showSeekBackward?: boolean },
  ): void;
  clearLockScreenControls?(): void;
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
  // What the lock screen shows for a story.
  lockScreenMetadata(story: PlayerStory): LockScreenMetadata;
  // False where the app has no media-control service (Expo Go): the native side then logs an
  // error to the console on every story that asks for one, and a try/catch cannot stop that
  // log. The engine does not ask. Left out, it means true (a real build).
  lockScreenAvailable?: boolean;
  // A player of the bundled silent file (SILENCE_FILE_SEC long).
  createSilencePlayer(): AudioPlayerLike;
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
  // Position in the current story, seconds, never beyond `durationSec`. The full length once the
  // story has ended (the pause after it).
  readonly positionSec: number;
  // The length the bar is drawn against: the player's own duration when it has reported one, else
  // the length the server stored (effectiveDuration).
  readonly durationSec: number;
  // 0 to 1; exactly 1 when the story has ended. Use it for the bar and the slider.
  readonly progress: number;
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

// A position change between two status events bigger than this is not playback (updates come
// every 0.5 s): it is a scrub on the lock screen or the like. A late batch of events in the
// background can look like a jump too; the only cost then is that the retry re-arms 5 s later.
export const EXTERNAL_JUMP_SEC = 3;

// The lock screen shows play/pause and the scrub bar, no skip buttons (owner, 2026-11-03).
const LOCK_SCREEN_OPTIONS: LockScreenOptions = { showSeekForward: false, showSeekBackward: false };

// A seek has landed when the native position is within this many seconds of its target.
const SEEK_LANDED_SEC = 1;

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
  private gapToken = 0;
  // The target of a seek that has not landed yet, and which seek it is.
  private seekTarget: number | null = null;
  private seekId = 0;
  // The play state we asked the story player for and have not seen confirmed yet (see the
  // lock-screen note above); null when nothing is waiting.
  private expectPlaying: boolean | null = null;
  // The lock-screen session of the current story player was (re)built with a known duration.
  // The first activation happens right after play(), before the stream is parsed, so the session
  // may have been built without a duration; the first status that reports one rebuilds it once.
  private lockScreenHasDuration = false;

  // The silent player of a pause, and which pause it is.
  private gapPlayer: AudioPlayerLike | null = null;
  private gapSubscription: { remove(): void } | null = null;
  private gap: 'between-stories' | 'before-waves' | null = null;

  private position = 0;
  // The duration the native player reported for the current story (0 until it does).
  private nativeDuration = 0;
  // The current story played to its end (the pause after it): the bar is full.
  private storyEnded = false;
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

  // Resolves when every listen report sent so far has finished (or failed). Two callers need the
  // listens to be on the server first: the continue request (it looks for unheard stories) and
  // the refresh of «Сегодня» after the night (the heard marks come from the listens).
  whenListensRecorded(): Promise<void> {
    return Promise.allSettled([...this.pending]).then(() => undefined);
  }

  start(): Promise<void> {
    return this.beginStory(0);
  }

  // ----- the person -----

  togglePause(): void {
    if (this.disposed || this.state.mode !== 'playing') return;
    this.send({ type: 'togglePause' });
    // In the pause between stories the silence is what pauses.
    const player = this.storyPlayer ?? this.gapPlayer;
    if (player === null) return;
    try {
      if (this.state.paused) player.pause();
      else player.play();
      if (player === this.storyPlayer) this.expectPlaying = !this.state.paused;
    } catch {
      // The player may be gone; the next status event or the next story sorts it out.
    }
  }

  // «Предыдущая»: after PREVIOUS_RESTART_AFTER_SEC of the story it starts the story again; before
  // that it goes to the previous story (on the first story it always starts it again). Going to
  // another story leaves this one like «Следующая» does: one report with the position at leave.
  // Starting the same story again reports nothing: the story is not left.
  pressPrevious(): void {
    if (this.disposed || this.state.mode !== 'playing') return;
    const position = this.storyEnded ? Number.MAX_SAFE_INTEGER : this.position;
    if (previousIntent(position, this.state.index) === 'restart') {
      this.restartCurrent();
      return;
    }
    this.reportCurrent(false);
    this.releaseStoryPlayer();
    this.releaseGap();
    this.send({ type: 'previousPressed' });
    void this.beginStory(this.state.index);
  }

  // A drag of the slider. Only inside a story that is playing: in a pause, in the waves and while
  // the next stream opens it is ignored. The target stays one second short of the end so that a
  // drag cannot end the story. A native seek, no timer. The listen report still means "the
  // position at leave" (owner: no anti-seek rule).
  seekTo(seconds: number): void {
    if (this.disposed || this.storyPlayer === null || this.gap !== null || this.storyEnded) return;
    if (this.state.mode !== 'playing' && this.state.mode !== 'dim') return;
    const story = this.stories[this.state.index];
    if (story === undefined || !Number.isFinite(seconds)) return;
    const target = clampSeekTarget(seconds, effectiveDuration(this.nativeDuration, story));
    this.position = target;
    // Where real progress is counted from: a jump must not count as five seconds of recovery.
    this.progressFrom = target;
    this.nativeSeek(this.storyPlayer, target);
    this.emit();
  }

  private restartCurrent(): void {
    if (this.disposed) return;
    if (this.storyPlayer === null) {
      // In the pause after the story, or while the stream opens: a fresh start of the same story.
      // A story already reported as finished is not reported a second time for the same play.
      const alreadyReported = this.storyEnded && this.reported;
      this.releaseGap();
      void this.beginStory(this.state.index, alreadyReported);
      return;
    }
    this.position = 0;
    this.progressFrom = 0;
    this.nativeSeek(this.storyPlayer, 0);
    this.emit();
  }

  // A native seek. Until it lands (the position comes near the target, or the seek settles) the
  // positions of the status events are ignored, so the bar does not jump back for one update.
  private nativeSeek(player: AudioPlayerLike, target: number): void {
    const seekId = this.seekId + 1;
    this.seekId = seekId;
    this.seekTarget = target;
    const settle = () => {
      if (this.seekId === seekId) this.seekTarget = null;
    };
    try {
      void player.seekTo(target).then(settle, settle);
    } catch {
      // The player may be gone; the next status event or the next story sorts it out.
      settle();
    }
  }

  // «Следующая». On the last story it starts the waves.
  pressNext(): void {
    if (this.disposed || this.state.mode !== 'playing') return;
    this.reportCurrent(false);
    this.releaseStoryPlayer();
    this.releaseGap();
    this.send({ type: 'nextPressed' });
    this.afterAdvance();
  }

  moon(): void {
    if (this.disposed) return;
    this.send({ type: 'moon' });
  }

  idle(): void {
    if (this.disposed) return;
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

  private resetStoryProgress(): void {
    this.retried = false;
    this.position = 0;
    this.nativeDuration = 0;
    this.storyEnded = false;
    this.reported = false;
    this.seekTarget = null;
    this.expectPlaying = null;
  }

  // `alreadyReported`: this play of the story was already reported as finished, so it is not
  // reported again when it ends or is left.
  private beginStory(index: number, alreadyReported = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.releaseGap();
    this.resetStoryProgress();
    this.reported = alreadyReported;
    // The view must not keep the full bar of the story that ended.
    this.emit();
    return this.loadStory(index, 0);
  }

  private async loadStory(index: number, resumeAtSec: number): Promise<void> {
    if (this.disposed) return;
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

    if (this.disposed || token !== this.storyToken) return;
    try {
      const player = this.deps.createStoryPlayer(story.url);
      this.storyPlayer = player;
      this.storySubscription = player.addListener('playbackStatusUpdate', (status) =>
        this.onStoryStatus(token, status),
      );
      if (resumeAtSec > 0) void player.seekTo(resumeAtSec).catch(() => undefined);
      if (!this.state.paused) {
        player.play();
        this.expectPlaying = true;
      }
      this.lockScreenHasDuration = false;
      this.activateLockScreen(player, story);
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
    if (Number.isFinite(status.currentTime) && !this.seekStillLanding(status.currentTime)) {
      // A jump that none of our seeks explains (a scrub on the lock screen) is not progress.
      if (Math.abs(status.currentTime - this.position) > EXTERNAL_JUMP_SEC) {
        this.progressFrom = status.currentTime;
      }
      this.position = status.currentTime;
    }
    if (Number.isFinite(status.duration) && status.duration > 0) this.nativeDuration = status.duration;
    if (status.didJustFinish) {
      this.finishStory();
      return;
    }
    if (status.playing) this.failures = 0;
    this.refreshLockScreenDuration(status);
    this.followNativePlayState(status);
    // Real progress after a retry re-arms the retry for the next error.
    if (this.retried && this.position >= this.progressFrom + RECOVERY_PROGRESS_SEC) {
      this.retried = false;
    }
    this.emit();
  }

  // A pause or play pressed outside the app (the lock screen, headphones, audio focus) changes
  // the native play state without a command of ours. Follow it in the machine, not in the player:
  // the player already did it.
  private followNativePlayState(status: PlayerStatusLike): void {
    if (this.expectPlaying !== null) {
      // Our own command is still on its way: events that contradict it are the old state.
      if (status.playing === this.expectPlaying) this.expectPlaying = null;
      return;
    }
    if (this.storyEnded || this.gap !== null || this.seekTarget !== null) return;
    if (status.isBuffering === true) return;
    // The machine already agrees with the player.
    if (status.playing !== this.state.paused) return;
    this.send({ type: status.playing ? 'nativePlayed' : 'nativePaused' });
  }

  // The system media control reads the duration when the session is built (expo-audio has no
  // duration in its metadata record and rebuilds the session only on setActiveForLockScreen).
  // If the stream's duration became known after that, activate the same player once more so the
  // control gets it. If the native player never reports a duration (an MP3 without a seek header
  // that ExoPlayer cannot measure), nothing happens here and the control stays as it was.
  private refreshLockScreenDuration(status: PlayerStatusLike): void {
    if (this.lockScreenHasDuration || this.storyPlayer === null) return;
    if (!Number.isFinite(status.duration) || status.duration <= 0) return;
    this.lockScreenHasDuration = true;
    const story = this.stories[this.state.index];
    if (story === undefined) return;
    this.activateLockScreen(this.storyPlayer, story);
  }

  private activateLockScreen(player: AudioPlayerLike, story: PlayerStory): void {
    if (this.deps.lockScreenAvailable === false) return;
    try {
      player.setActiveForLockScreen?.(true, this.deps.lockScreenMetadata(story), LOCK_SCREEN_OPTIONS);
    } catch {
      // No lock-screen control is not a reason to stop the story.
    }
  }

  // The story played to its end. The bar is full from here until the next story starts.
  // True while a seek has not landed: the native position is still far from the target.
  private seekStillLanding(currentTime: number): boolean {
    if (this.seekTarget === null) return false;
    if (Math.abs(currentTime - this.seekTarget) <= SEEK_LANDED_SEC) {
      this.seekTarget = null;
      return false;
    }
    return true;
  }

  private finishStory(): void {
    if (this.state.mode !== 'playing' && this.state.mode !== 'dim') return;
    this.reportCurrent(true);
    this.storyEnded = true;
    this.releaseStoryPlayer();
    if (isLastStory(this.state)) {
      this.send({ type: 'storyEnded' });
      this.startGap('before-waves');
    } else {
      // The index moves on when the next story starts (endGap).
      this.startGap('between-stories');
    }
    this.emit();
  }

  // After the machine moved on from a story by the person's press or a skip: the next story at
  // once, or the pause and the waves after the last one.
  private afterAdvance(): void {
    if (isWaves(this.state)) this.startGap('before-waves');
    else void this.beginStory(this.state.index);
  }

  // ----- the pauses -----

  private startGap(kind: 'between-stories' | 'before-waves'): void {
    if (this.disposed) return;
    this.releaseGap();
    this.gap = kind;
    const token = this.gapToken;
    try {
      const player = this.deps.createSilencePlayer();
      this.gapPlayer = player;
      this.gapSubscription = player.addListener('playbackStatusUpdate', (status) =>
        this.onGapStatus(token, status),
      );
      if (!this.state.paused) player.play();
    } catch {
      // No silence available: go on at once rather than hold the night.
      this.endGap(token);
    }
  }

  private onGapStatus(token: number, status: PlayerStatusLike): void {
    if (this.disposed || token !== this.gapToken) return;
    if (status.error || status.didJustFinish) this.endGap(token);
  }

  private endGap(token: number): void {
    if (this.disposed || token !== this.gapToken || this.gap === null) return;
    const kind = this.gap;
    this.releaseGap();
    if (kind === 'between-stories') {
      if (this.state.mode !== 'playing' && this.state.mode !== 'dim') return;
      this.resetStoryProgress();
      this.send({ type: 'storyEnded' });
      void this.beginStory(this.state.index);
      return;
    }
    // A touch during the pause already asked the server to continue: no waves then.
    if (isWaves(this.state) && !this.state.continuing) this.startWaves();
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
    if (this.disposed) return;
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
      // In from silence: the first status events raise it (wavesVolume).
      player.volume = wavesVolume(0, WAVES_NOMINAL_SEC);
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
    await this.whenListensRecorded();
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
      this.releaseGap();
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
    this.releaseGap();
    this.releaseWaves();
  }

  private releaseStoryPlayer(): void {
    this.storyToken += 1;
    this.seekTarget = null;
    this.expectPlaying = null;
    this.lockScreenHasDuration = false;
    try {
      this.storyPlayer?.clearLockScreenControls?.();
    } catch {
      // Already released.
    }
    release(this.storyPlayer, this.storySubscription);
    this.storyPlayer = null;
    this.storySubscription = null;
  }

  private releaseGap(): void {
    this.gapToken += 1;
    release(this.gapPlayer, this.gapSubscription);
    this.gapPlayer = null;
    this.gapSubscription = null;
    this.gap = null;
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
    const story = this.stories[this.state.index];
    const durationSec = story === undefined ? 0 : effectiveDuration(this.nativeDuration, story);
    const positionSec = this.storyEnded
      ? durationSec
      : durationSec > 0
        ? Math.min(durationSec, Math.max(0, this.position))
        : Math.max(0, this.position);
    return {
      state: this.state,
      stories: this.stories,
      positionSec,
      durationSec,
      progress: storyProgress(this.position, durationSec, this.storyEnded),
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

import { LISTEN_MIN_SEC, type QueueItem } from '@sleep-stories/contracts';

// Pure helpers of the stories player: the snapshot of the night, signed-URL age, the listen
// report rule and the waves maths. No React Native, no audio, no clock of its own.

// Idle time in the player view before the interface goes near-black. ARCHITECTURE.md section 7
// says "a few seconds" and "a setting" without a number; the owner set 20 seconds for the
// player. A JS timer, used only while the screen is on.
export const IDLE_DIM_MS = 20_000;

// Safety net: the keep-awake lock is released after this long whatever happens
// (ARCHITECTURE.md section 7, "The screen during a night").
export const KEEP_AWAKE_MAX_MS = 10 * 60 * 60 * 1000;

// Signed audio URLs in the queue answer live 30 minutes and a night lasts hours: a URL older
// than this is replaced from a fresh GET /api/queue before its story starts.
export const URL_MAX_AGE_MS = 20 * 60 * 1000;

// The bundled waves file is 20 s long. Used for the countdown until the player has reported
// the real duration.
export const WAVES_NOMINAL_SEC = 20;

// The waves play at full volume for this share of their length, then fade out linearly to
// silence at the end (ARCHITECTURE.md section 7 says the sound "fades out over about 20 seconds").
export const WAVES_FADE_START = 0.25;

// The waves come in from silence over their first seconds (owner, 2026-11-03).
export const WAVES_FADE_IN_SEC = 3;

// Silence before the waves, after the last story (owner, 2026-11-03), and between two stories so
// that they do not run into each other. Both are played by the bundled silent file
// (assets/audio/silence-3s.wav), so they equal its length; player-stories.spec.ts reads the file
// header and fails if it does not match SILENCE_FILE_SEC. The wait is a native playback of that
// file, never a JavaScript timer (the Android background constraint, ARCHITECTURE.md section 7).
export const SILENCE_FILE_SEC = 3;
export const WAVES_GAP_BEFORE_SEC = 3;
export const STORY_GAP_SEC = 3;

// «Предыдущая» restarts the current story when it has played longer than this, and goes to the
// previous story otherwise (the usual media-player rule; owner, 2026-11-03).
export const PREVIOUS_RESTART_AFTER_SEC = 3;

// One story of the night as the player holds it. The snapshot is taken when the player opens
// and again when a touch during the waves finds more ready stories.
export type PlayerStory = {
  readonly storyId: string;
  readonly title: string;
  readonly style: QueueItem['style'];
  readonly durationSec: number;
  // Signed, short-lived. Never stored anywhere; replaced from a fresh queue read before it expires.
  readonly url: string;
  // Epoch milliseconds when the url came from the server; 0 means "unknown age", which counts
  // as stale (a queue read out of the cache may be old).
  readonly urlFetchedAt: number;
};

// The ready items of a queue answer, in queue order.
export function readyStories(items: readonly QueueItem[], fetchedAt: number): PlayerStory[] {
  const stories: PlayerStory[] = [];
  for (const item of items) {
    if (item.state !== 'ready') continue;
    stories.push({
      storyId: item.storyId,
      title: item.title,
      style: item.style,
      durationSec: item.durationSec,
      url: item.audioUrl,
      urlFetchedAt: fetchedAt,
    });
  }
  return stories;
}

export function urlIsStale(story: PlayerStory, now: number): boolean {
  return story.urlFetchedAt <= 0 || now - story.urlFetchedAt >= URL_MAX_AGE_MS;
}

// Takes the URLs of a fresh queue answer by story id. A story that is not in the answer (it
// was listened to or removed meanwhile) keeps its old URL: it may still play.
export function withFreshUrls(
  stories: readonly PlayerStory[],
  fresh: ReadonlyMap<string, string>,
  now: number,
): PlayerStory[] {
  return stories.map((story) => {
    const url = fresh.get(story.storyId);
    return url === undefined ? story : { ...story, url, urlFetchedAt: now };
  });
}

export function urlsByStoryId(items: readonly QueueItem[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const item of items) {
    if (item.state === 'ready') urls.set(item.storyId, item.audioUrl);
  }
  return urls;
}

// The whole seconds heard in a story, or null when the listen is too short to report
// (LISTEN_MIN_SEC; the server enforces the same rule). A story that played to its end counts
// as at least its full length: the native position can stop a fraction short of it, and the
// server derives "finished" from this number and the duration.
export function listenSecondsToReport(
  positionSec: number,
  story: Pick<PlayerStory, 'durationSec'>,
  finished: boolean,
): number | null {
  const heard = Number.isFinite(positionSec) && positionSec > 0 ? Math.floor(positionSec) : 0;
  const sec = finished ? Math.max(heard, story.durationSec) : heard;
  return sec >= LISTEN_MIN_SEC ? sec : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function safeDuration(durationSec: number): number {
  return Number.isFinite(durationSec) && durationSec > 0 ? durationSec : WAVES_NOMINAL_SEC;
}

// Volume of the waves as a function of the native playback position (never a timer): the
// smaller of the fade-in over the first WAVES_FADE_IN_SEC and the fade-out over the last part.
export function wavesVolume(positionSec: number, durationSec: number): number {
  const duration = safeDuration(durationSec);
  const position = Number.isFinite(positionSec) ? positionSec : 0;
  const fadeIn = clamp01(position / WAVES_FADE_IN_SEC);
  const played = clamp01(position / duration);
  const fadeOut =
    played <= WAVES_FADE_START ? 1 : clamp01(1 - (played - WAVES_FADE_START) / (1 - WAVES_FADE_START));
  return Math.min(fadeIn, fadeOut);
}

// The number inside the ring of design 3c: whole seconds left, counting down to 0.
export function wavesSecondsLeft(positionSec: number, durationSec: number): number {
  const duration = safeDuration(durationSec);
  const left = Math.ceil(duration - (Number.isFinite(positionSec) ? positionSec : 0));
  return Math.min(Math.ceil(duration), Math.max(0, left));
}

// 0 (full ring) to 1 (empty ring) for the ring of design 3c.
export function wavesRingProgress(positionSec: number, durationSec: number): number {
  return clamp01((Number.isFinite(positionSec) ? positionSec : 0) / safeDuration(durationSec));
}

// ----- the progress of a story, the slider and «Предыдущая» -----

// The length the bar is drawn against: what the native player reports for the audio it plays,
// else the length the server stored. The two can differ by a second or more (the server reads
// the file with a parser and rounds; a streamed file's duration is the player's own estimate), and
// a bar drawn against the wrong one stops short of the edge or runs into it early.
export function effectiveDuration(
  nativeDurationSec: number,
  story: Pick<PlayerStory, 'durationSec'>,
): number {
  if (Number.isFinite(nativeDurationSec) && nativeDurationSec > 0) return nativeDurationSec;
  return Number.isFinite(story.durationSec) && story.durationSec > 0 ? story.durationSec : 0;
}

// 0 to 1, always inside the range. A story that ended is exactly 1 whatever the last native
// position was (it stops a fraction short of the end).
export function storyProgress(positionSec: number, durationSec: number, ended: boolean): number {
  if (ended) return 1;
  if (!(durationSec > 0) || !Number.isFinite(positionSec)) return 0;
  return clamp01(positionSec / durationSec);
}

// Where a slider drag may land: inside the story, one second short of its end so that a drag
// cannot make the story end by itself.
export function clampSeekTarget(targetSec: number, durationSec: number): number {
  const last = Number.isFinite(durationSec) ? Math.max(0, durationSec - 1) : 0;
  const target = Number.isFinite(targetSec) ? targetSec : 0;
  return Math.min(last, Math.max(0, target));
}

// The slider position (0 to 1) as seconds of the story.
export function secondsAtFraction(fraction: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return clamp01(Number.isFinite(fraction) ? fraction : 0) * durationSec;
}

// What «Предыдущая» does. After more than PREVIOUS_RESTART_AFTER_SEC of the story it starts the
// story again; before that it goes to the previous story, except on the first, which it starts again.
export type PreviousIntent = 'restart' | 'previous-story';

export function previousIntent(positionSec: number, index: number): PreviousIntent {
  if (Number.isFinite(positionSec) && positionSec > PREVIOUS_RESTART_AFTER_SEC) return 'restart';
  return index > 0 ? 'previous-story' : 'restart';
}

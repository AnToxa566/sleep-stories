import type { ContinueResponse, QueueItem } from '@sleep-stories/contracts';
import {
  NightEngine,
  RECOVERY_PROGRESS_SEC,
  REQUEST_TIMEOUT_MS,
  type AudioPlayerLike,
  type NightDeps,
  type NightExit,
  type PlayerStatusLike,
} from './night-engine';
import {
  PREVIOUS_RESTART_AFTER_SEC,
  URL_MAX_AGE_MS,
  type PlayerStory,
} from './player-stories';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakePlayer implements AudioPlayerLike {
  volume = 1;
  currentTime = 0;
  playing = false;
  removed = false;
  seeks: number[] = [];
  private listener: ((status: PlayerStatusLike) => void) | null = null;
  constructor(readonly url: string) {}
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  remove() {
    this.removed = true;
  }
  // When set, a seek stays pending until `landSeeks()`; the position does not move meanwhile.
  holdSeeks = false;
  private heldSeeks: (() => void)[] = [];
  seekTo(seconds: number): Promise<void> {
    this.seeks.push(seconds);
    if (this.holdSeeks) {
      return new Promise<void>((resolve) => {
        this.heldSeeks.push(() => {
          this.currentTime = seconds;
          resolve();
        });
      });
    }
    this.currentTime = seconds;
    return Promise.resolve();
  }
  landSeeks() {
    const held = this.heldSeeks;
    this.heldSeeks = [];
    held.forEach((land) => land());
  }
  addListener(_event: 'playbackStatusUpdate', listener: (status: PlayerStatusLike) => void) {
    this.listener = listener;
    return {
      remove: () => {
        this.listener = null;
      },
    };
  }
  // Test side: what native playback would send.
  status(partial: Partial<PlayerStatusLike> = {}) {
    this.listener?.({
      currentTime: this.currentTime,
      duration: 185,
      playing: this.playing,
      didJustFinish: false,
      error: null,
      ...partial,
    });
  }
  finish() {
    this.currentTime = 184.6;
    this.status({ didJustFinish: true, playing: false });
  }
  get subscribed() {
    return this.listener !== null;
  }
}

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function story(n: number, fetchedAt = 1): PlayerStory {
  return {
    storyId: ID(n),
    title: `Story ${n}`,
    style: 'facts',
    durationSec: 185,
    url: `https://audio.test/${n}?old`,
    urlFetchedAt: fetchedAt,
  };
}

function readyItem(n: number): QueueItem {
  return {
    id: ID(n + 5),
    topicId: ID(n + 6),
    title: `Again ${n}`,
    style: 'history',
    heard: false,
    state: 'ready',
    storyId: ID(n + 7),
    durationSec: 120,
    audioUrl: `https://audio.test/again-${n}`,
  };
}

function continueResponse(outcome: 'ready' | 'none_ready', items: QueueItem[]): ContinueResponse {
  return {
    outcome,
    queue: { items, generations: { left: 5, limit: 5 }, collecting: false },
  };
}

type Harness = {
  engine: NightEngine;
  deps: jest.Mocked<NightDeps>;
  storyPlayers: FakePlayer[];
  wavesPlayers: FakePlayer[];
  silencePlayers: FakePlayer[];
  exits: NightExit[];
  clock: { now: number };
};

function setup(count = 3, options: { fetchedAt?: number } = {}): Harness {
  const storyPlayers: FakePlayer[] = [];
  const wavesPlayers: FakePlayer[] = [];
  const silencePlayers: FakePlayer[] = [];
  const exits: NightExit[] = [];
  const clock = { now: 1_000_000 };
  const fetchedAt = options.fetchedAt ?? clock.now;
  const deps: jest.Mocked<NightDeps> = {
    createStoryPlayer: jest.fn((url: string) => {
      const player = new FakePlayer(url);
      storyPlayers.push(player);
      return player;
    }),
    createWavesPlayer: jest.fn(() => {
      const player = new FakePlayer('waves');
      wavesPlayers.push(player);
      return player;
    }),
    createSilencePlayer: jest.fn(() => {
      const player = new FakePlayer('silence');
      silencePlayers.push(player);
      return player;
    }),
    reportListen: jest.fn((_storyId: string, _listenedSec: number) => Promise.resolve()),
    fetchFreshUrls: jest.fn(() => Promise.resolve(null)),
    continueNight: jest.fn(),
    now: jest.fn(() => clock.now),
    onExit: jest.fn((exit: NightExit) => {
      exits.push(exit);
    }),
  };
  const stories = Array.from({ length: count }, (_, i) => story(i + 1, fetchedAt));
  return {
    engine: new NightEngine(deps, stories),
    deps,
    storyPlayers,
    wavesPlayers,
    silencePlayers,
    exits,
    clock,
  };
}

async function started(count = 3): Promise<Harness> {
  const h = setup(count);
  await h.engine.start();
  return h;
}

// The native end of the silence of the pause that is playing now.
async function endPause(h: Harness): Promise<void> {
  h.silencePlayers[h.silencePlayers.length - 1].finish();
  await flush();
}

// The current story plays to its end and the pause after it runs out.
async function endStoryAndPause(h: Harness): Promise<void> {
  h.storyPlayers[h.storyPlayers.length - 1].finish();
  await flush();
  await endPause(h);
}

async function toWaves(h: Harness): Promise<void> {
  for (let i = 0; i < h.engine.getView().state.count; i += 1) {
    await endStoryAndPause(h);
  }
}

describe('NightEngine: starting', () => {
  it('plays the first story from the URL it holds when the URL is fresh', async () => {
    const h = await started();
    expect(h.deps.fetchFreshUrls).not.toHaveBeenCalled();
    expect(h.storyPlayers).toHaveLength(1);
    expect(h.storyPlayers[0].url).toBe('https://audio.test/1?old');
    expect(h.storyPlayers[0].playing).toBe(true);
  });

  it('reads the queue again first when the age of the URLs is unknown, and uses the fresh URL', async () => {
    const h = setup(2, { fetchedAt: 0 });
    h.deps.fetchFreshUrls.mockResolvedValue(new Map([[ID(1), 'https://audio.test/1?new']]));
    await h.engine.start();
    expect(h.deps.fetchFreshUrls).toHaveBeenCalledTimes(1);
    expect(h.storyPlayers[0].url).toBe('https://audio.test/1?new');
  });

  it('falls back to the URL it holds when the queue cannot be read', async () => {
    const h = setup(1, { fetchedAt: 0 });
    h.deps.fetchFreshUrls.mockRejectedValue(new Error('offline'));
    await h.engine.start();
    expect(h.storyPlayers[0].url).toBe('https://audio.test/1?old');
  });
});

describe('NightEngine: stories in a row', () => {
  it('moves to the next story when one ends, removes the old player and reports the listen', async () => {
    const h = await started();
    const first = h.storyPlayers[0];
    first.finish();
    await flush();
    expect(first.removed).toBe(true);
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 185);
    await endPause(h);
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.storyPlayers[1].url).toBe('https://audio.test/2?old');
    expect(h.storyPlayers[1].playing).toBe(true);
    expect(h.engine.getView().state.index).toBe(1);
  });

  it('reports one listen per story, whole seconds, when «Следующая» is pressed', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 30.7;
    h.engine.pressNext();
    await flush();
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 30);
    expect(h.engine.getView().state.index).toBe(1);
  });

  it('does not report a listen shorter than the minimum', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 4.2;
    h.engine.pressNext();
    await flush();
    expect(h.deps.reportListen).not.toHaveBeenCalled();
  });

  it('restarts the story on «Предыдущая» and reports nothing', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 50;
    h.storyPlayers[0].status();
    h.engine.pressPrevious();
    expect(h.storyPlayers[0].seeks).toEqual([0]);
    expect(h.engine.getView().positionSec).toBe(0);
    expect(h.deps.reportListen).not.toHaveBeenCalled();
    expect(h.engine.getView().state.index).toBe(0);
  });

  it('pauses and resumes the player with the button', async () => {
    const h = await started();
    h.engine.togglePause();
    expect(h.storyPlayers[0].playing).toBe(false);
    expect(h.engine.getView().state.paused).toBe(true);
    h.engine.togglePause();
    expect(h.storyPlayers[0].playing).toBe(true);
  });

  it('keeps playing across the dimmed look and back', async () => {
    const h = await started();
    h.engine.moon();
    expect(h.engine.getView().state.mode).toBe('dim');
    expect(h.storyPlayers[0].playing).toBe(true);
    h.engine.touch();
    expect(h.engine.getView().state.mode).toBe('playing');
    expect(h.storyPlayers[0].playing).toBe(true);
  });

  it('refreshes the URLs before a story whose URL is older than the limit', async () => {
    const h = await started();
    h.clock.now += URL_MAX_AGE_MS + 1;
    h.deps.fetchFreshUrls.mockResolvedValue(
      new Map([
        [ID(2), 'https://audio.test/2?new'],
        [ID(3), 'https://audio.test/3?new'],
      ]),
    );
    await endStoryAndPause(h);
    expect(h.deps.fetchFreshUrls).toHaveBeenCalledTimes(1);
    expect(h.storyPlayers[1].url).toBe('https://audio.test/2?new');
  });

  it('ignores a late event from a player that was released', async () => {
    const h = await started();
    const first = h.storyPlayers[0];
    first.finish();
    await flush();
    first.status({ didJustFinish: true });
    await flush();
    await endPause(h);
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
  });
});

describe('NightEngine: the end of the night', () => {
  it('starts the waves after the pause that follows the last story, fades them in, then out by the native position', async () => {
    const h = await started(1);
    h.storyPlayers[0].finish();
    await flush();
    expect(h.engine.getView().state.mode).toBe('waves');
    // The silence plays; the waves have not started and the countdown is full.
    expect(h.silencePlayers).toHaveLength(1);
    expect(h.silencePlayers[0].playing).toBe(true);
    expect(h.wavesPlayers).toHaveLength(0);
    expect(h.engine.getView().wavesLeftSec).toBe(20);
    await endPause(h);
    expect(h.silencePlayers[0].removed).toBe(true);
    expect(h.wavesPlayers).toHaveLength(1);
    const waves = h.wavesPlayers[0];
    expect(waves.playing).toBe(true);
    expect(waves.volume).toBe(0);

    waves.status({ currentTime: 1.5, duration: 20 });
    expect(waves.volume).toBeCloseTo(0.5);
    waves.status({ currentTime: 4, duration: 20 });
    expect(waves.volume).toBe(1);
    expect(h.engine.getView().wavesLeftSec).toBe(16);

    waves.status({ currentTime: 12, duration: 20 });
    expect(waves.volume).toBeGreaterThan(0.3);
    expect(waves.volume).toBeLessThan(0.7);

    waves.status({ currentTime: 19.8, duration: 20 });
    expect(waves.volume).toBeLessThan(0.05);
  });

  it('starts the waves on «Следующая» on the last story', async () => {
    const h = await started(1);
    h.storyPlayers[0].currentTime = 40;
    h.engine.pressNext();
    await flush();
    expect(h.engine.getView().state.mode).toBe('waves');
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 40);
    expect(h.storyPlayers[0].removed).toBe(true);
  });

  it('falls asleep when the waves end with no touch, and stops all audio', async () => {
    const h = await started(1);
    await endStoryAndPause(h);
    h.wavesPlayers[0].status({ currentTime: 20, duration: 20, didJustFinish: true, playing: false });
    expect(h.engine.getView().state.mode).toBe('asleep');
    expect(h.wavesPlayers[0].removed).toBe(true);
    expect(h.exits).toEqual([]);
  });

  it('keeps the dimmed look through the waves and into sleep', async () => {
    const h = await started(1);
    h.engine.moon();
    await endStoryAndPause(h);
    expect(h.engine.getView().state.mode).toBe('waves-dim');
    h.wavesPlayers[0].status({ currentTime: 20, duration: 20, didJustFinish: true });
    expect(h.engine.getView().state.mode).toBe('asleep');
  });

  it('goes to «Сегодня» on a touch on the asleep screen', async () => {
    const h = await started(1);
    await endStoryAndPause(h);
    h.wavesPlayers[0].status({ currentTime: 20, duration: 20, didJustFinish: true });
    h.engine.touch();
    expect(h.exits).toEqual(['woke']);
  });

  it('goes to sleep without sound when the waves cannot be created', async () => {
    const h = await started(1);
    h.deps.createWavesPlayer.mockImplementation(() => {
      throw new Error('no file');
    });
    await endStoryAndPause(h);
    expect(h.engine.getView().state.mode).toBe('asleep');
  });
});

describe('NightEngine: a touch during the waves', () => {
  async function inWaves(count = 1): Promise<Harness> {
    const h = await started(count);
    await toWaves(h);
    return h;
  }

  it('waits for the listen report of the last story before it asks the server', async () => {
    const h = await started(1);
    let release: () => void = () => undefined;
    h.deps.reportListen.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    h.storyPlayers[0].finish();
    await flush();
    h.deps.continueNight.mockResolvedValue(continueResponse('none_ready', []));
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).not.toHaveBeenCalled();
    release();
    await flush();
    expect(h.deps.continueNight).toHaveBeenCalledTimes(1);
  });

  it('replaces the snapshot with the ready stories and plays them from the first', async () => {
    const h = await inWaves(2);
    h.deps.continueNight.mockResolvedValue(
      continueResponse('ready', [readyItem(1), readyItem(2), readyItem(3)]),
    );
    h.engine.touch();
    await flush();
    const view = h.engine.getView();
    expect(view.state).toMatchObject({ mode: 'playing', index: 0, count: 3, continuing: false });
    expect(view.stories.map((s) => s.title)).toEqual(['Again 1', 'Again 2', 'Again 3']);
    expect(h.wavesPlayers[0].removed).toBe(true);
    const last = h.storyPlayers[h.storyPlayers.length - 1];
    expect(last.url).toBe('https://audio.test/again-1');
    expect(last.playing).toBe(true);
    expect(h.deps.fetchFreshUrls).not.toHaveBeenCalled();
    expect(h.exits).toEqual([]);
  });

  it('shows 3c on a touch during the dimmed waves: no request, the waves play on', async () => {
    const h = await started(1);
    h.engine.moon();
    await endStoryAndPause(h);
    const waves = h.wavesPlayers[0];
    waves.status({ currentTime: 8, duration: 20 });
    expect(h.engine.getView().state.mode).toBe('waves-dim');
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).not.toHaveBeenCalled();
    expect(h.wavesPlayers).toHaveLength(1);
    expect(waves.removed).toBe(false);
    expect(waves.playing).toBe(true);
    const view = h.engine.getView();
    expect(view.state).toMatchObject({ mode: 'waves', continuing: false });
    // The countdown goes on from the real position, not from the start.
    expect(view.wavesLeftSec).toBe(12);
    waves.status({ currentTime: 9, duration: 20 });
    expect(h.engine.getView().wavesLeftSec).toBe(11);
  });

  it('continues only on the next touch, once 3c is shown', async () => {
    const h = await started(1);
    h.engine.moon();
    h.storyPlayers[0].finish();
    await flush();
    h.deps.continueNight.mockResolvedValue(continueResponse('ready', [readyItem(1)]));
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).not.toHaveBeenCalled();
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).toHaveBeenCalledTimes(1);
    expect(h.engine.getView().state.mode).toBe('playing');
  });

  it('falls asleep when the waves end after the dimmed look was left with no further touch', async () => {
    const h = await started(1);
    h.engine.moon();
    await endStoryAndPause(h);
    h.engine.touch();
    h.wavesPlayers[0].status({ currentTime: 20, duration: 20, didJustFinish: true });
    expect(h.engine.getView().state.mode).toBe('asleep');
    expect(h.deps.continueNight).not.toHaveBeenCalled();
    h.engine.touch();
    expect(h.exits).toEqual(['woke']);
  });

  it('stops everything and goes to «Сегодня» when none are ready', async () => {
    const h = await inWaves();
    h.deps.continueNight.mockResolvedValue(continueResponse('none_ready', []));
    h.engine.touch();
    await flush();
    expect(h.exits).toEqual(['none-ready']);
    expect(h.wavesPlayers[0].removed).toBe(true);
  });

  it('treats a ready answer with no ready item as none ready', async () => {
    const h = await inWaves();
    h.deps.continueNight.mockResolvedValue(continueResponse('ready', []));
    h.engine.touch();
    await flush();
    expect(h.exits).toEqual(['none-ready']);
  });

  it('goes to «Сегодня» with an error when the request fails', async () => {
    const h = await inWaves();
    h.deps.continueNight.mockRejectedValue(new Error('offline'));
    h.engine.touch();
    await flush();
    expect(h.exits).toEqual(['error']);
    expect(h.wavesPlayers[0].removed).toBe(true);
  });

  it('sends one request however many times the screen is touched', async () => {
    const h = await inWaves();
    let answer: (value: ContinueResponse) => void = () => undefined;
    h.deps.continueNight.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    h.engine.touch();
    h.engine.touch();
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).toHaveBeenCalledTimes(1);
    expect(h.engine.getView().state.continuing).toBe(true);
    answer(continueResponse('none_ready', []));
    await flush();
    expect(h.exits).toEqual(['none-ready']);
  });

  it('does not fall asleep while the request is in flight', async () => {
    const h = await inWaves();
    let answer: (value: ContinueResponse) => void = () => undefined;
    h.deps.continueNight.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    h.engine.touch();
    await flush();
    h.wavesPlayers[0].status({ currentTime: 20, duration: 20, didJustFinish: true });
    expect(h.engine.getView().state.mode).toBe('waves');
    answer(continueResponse('ready', [readyItem(1)]));
    await flush();
    expect(h.engine.getView().state.mode).toBe('playing');
  });

  it('drops the answer when the person left meanwhile', async () => {
    const h = await inWaves();
    let answer: (value: ContinueResponse) => void = () => undefined;
    h.deps.continueNight.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    h.engine.touch();
    await flush();
    h.engine.leave();
    answer(continueResponse('ready', [readyItem(1)]));
    await flush();
    expect(h.exits).toEqual(['leave']);
    expect(h.storyPlayers).toHaveLength(1);
  });
});

describe('NightEngine: leaving', () => {
  it('stops the player, reports the story being left and says so once', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 61.9;
    h.engine.leave();
    h.engine.leave();
    expect(h.storyPlayers[0].removed).toBe(true);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 61);
    expect(h.exits).toEqual(['leave']);
  });

  it('reports nothing for a story that was already reported', async () => {
    const h = await started(1);
    h.storyPlayers[0].finish();
    await flush();
    h.engine.leave();
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
  });

  it('stops the waves when leaving during them', async () => {
    const h = await started(1);
    await endStoryAndPause(h);
    h.engine.leave();
    expect(h.wavesPlayers[0].removed).toBe(true);
    expect(h.exits).toEqual(['leave']);
  });

  it('settles the reports so the screen can refresh the heard marks', async () => {
    const h = await started();
    let release: () => void = () => undefined;
    h.deps.reportListen.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    h.storyPlayers[0].currentTime = 30;
    h.engine.leave();
    let settled = false;
    void h.engine.whenListensRecorded().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    release();
    await flush();
    expect(settled).toBe(true);
  });

  it('never blocks on a failing report', async () => {
    const h = await started();
    h.deps.reportListen.mockRejectedValue(new Error('offline'));
    h.storyPlayers[0].currentTime = 30;
    h.engine.pressNext();
    await flush();
    await expect(h.engine.whenListensRecorded()).resolves.toBeUndefined();
    expect(h.storyPlayers).toHaveLength(2);
  });

  it('releases everything on dispose without navigating', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 30;
    h.engine.dispose();
    expect(h.storyPlayers[0].removed).toBe(true);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.exits).toEqual([]);
  });
});

describe('NightEngine: playback errors', () => {
  it('tries the same story once more with a fresh URL, from where it stopped', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 70;
    h.storyPlayers[0].status();
    h.deps.fetchFreshUrls.mockResolvedValue(new Map([[ID(1), 'https://audio.test/1?new']]));
    h.storyPlayers[0].status({ error: 'expired' });
    await flush();
    expect(h.storyPlayers[0].removed).toBe(true);
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.storyPlayers[1].url).toBe('https://audio.test/1?new');
    expect(h.storyPlayers[1].seeks).toEqual([70]);
    expect(h.engine.getView().state.index).toBe(0);
  });

  it('skips a story that fails twice, without a listen report', async () => {
    const h = await started();
    h.storyPlayers[0].status({ error: 'bad' });
    await flush();
    h.storyPlayers[1].status({ error: 'bad' });
    await flush();
    expect(h.engine.getView().state.index).toBe(1);
    expect(h.deps.reportListen).not.toHaveBeenCalled();
    expect(h.storyPlayers[h.storyPlayers.length - 1].url).toContain('/2');
  });

  it('ends the night quietly after two failed stories in a row', async () => {
    const h = await started();
    h.storyPlayers[0].status({ error: 'bad' });
    await flush();
    h.storyPlayers[1].status({ error: 'bad' });
    await flush();
    h.storyPlayers[2].status({ error: 'bad' });
    await flush();
    h.storyPlayers[3].status({ error: 'bad' });
    await flush();
    expect(h.engine.getView().state.mode).toBe('asleep');
    expect(h.storyPlayers.every((player) => player.removed)).toBe(true);
  });

  it('forgets earlier failures once a story plays', async () => {
    const h = await started();
    h.storyPlayers[0].status({ error: 'bad' });
    await flush();
    h.storyPlayers[1].status({ error: 'bad' });
    await flush();
    const second = h.storyPlayers[2];
    second.playing = true;
    second.status();
    second.status({ error: 'bad' });
    await flush();
    expect(h.engine.getView().state.mode).toBe('playing');
  });
});

describe('NightEngine: errors after progress', () => {
  it('retries again when the story played on after the first retry', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 70;
    h.storyPlayers[0].status();
    h.storyPlayers[0].status({ error: 'expired' });
    await flush();
    const retry = h.storyPlayers[1];
    retry.currentTime = 70 + RECOVERY_PROGRESS_SEC;
    retry.status();
    retry.status({ error: 'expired again' });
    await flush();
    expect(h.storyPlayers).toHaveLength(3);
    expect(h.storyPlayers[2].seeks).toEqual([70 + RECOVERY_PROGRESS_SEC]);
    expect(h.engine.getView().state.index).toBe(0);
    expect(h.deps.reportListen).not.toHaveBeenCalled();
  });

  it('does not re-arm the retry on the first playing event alone', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 70;
    h.storyPlayers[0].status();
    h.storyPlayers[0].status({ error: 'expired' });
    await flush();
    const retry = h.storyPlayers[1];
    retry.status({ currentTime: 70, playing: true });
    retry.status({ error: 'dead' });
    await flush();
    expect(h.engine.getView().state.index).toBe(1);
  });

  it('reports the heard seconds once when a story is skipped after two errors without progress', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 40;
    h.storyPlayers[0].status();
    h.storyPlayers[0].status({ error: 'bad' });
    await flush();
    h.storyPlayers[1].status({ error: 'bad' });
    await flush();
    expect(h.engine.getView().state.index).toBe(1);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 40);
  });

  it('reports the heard part when the night is given up', async () => {
    const h = await started();
    // Story 1 fails twice at once and is skipped (nothing heard, one failure).
    h.storyPlayers[0].status({ error: 'bad' });
    await flush();
    h.storyPlayers[1].status({ error: 'bad' });
    await flush();
    // Story 2 was heard for 50 s, then fails twice without progress: the night ends.
    const second = h.storyPlayers[2];
    second.status({ currentTime: 50, playing: false });
    second.status({ error: 'bad' });
    await flush();
    h.storyPlayers[3].status({ error: 'bad' });
    await flush();
    expect(h.engine.getView().state.mode).toBe('asleep');
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(2), 50);
  });
});

describe('NightEngine: requests that stall', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('plays the URL it holds when reading the queue takes too long', async () => {
    const h = setup(1, { fetchedAt: 0 });
    h.deps.fetchFreshUrls.mockReturnValue(new Promise(() => undefined));
    const starting = h.engine.start();
    await flush();
    expect(h.storyPlayers).toHaveLength(0);
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    await starting;
    expect(h.storyPlayers).toHaveLength(1);
    expect(h.storyPlayers[0].url).toBe('https://audio.test/1?old');
  });

  it('treats a continue request that takes too long as a network error', async () => {
    const h = await started(1);
    await endStoryAndPause(h);
    h.deps.continueNight.mockReturnValue(new Promise(() => undefined));
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).toHaveBeenCalledTimes(1);
    expect(h.exits).toEqual([]);
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    await flush();
    expect(h.exits).toEqual(['error']);
    expect(h.wavesPlayers[0].removed).toBe(true);
  });
});

describe('NightEngine: the view', () => {
  it('notifies subscribers and exposes the position', async () => {
    const h = await started();
    const listener = jest.fn();
    const unsubscribe = h.engine.subscribe(listener);
    h.storyPlayers[0].currentTime = 12;
    h.storyPlayers[0].status();
    expect(listener).toHaveBeenCalled();
    expect(h.engine.getView().positionSec).toBe(12);
    unsubscribe();
    listener.mockClear();
    h.storyPlayers[0].status();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('NightEngine: «Предыдущая»', () => {
  async function onSecond(): Promise<Harness> {
    const h = await started();
    h.storyPlayers[0].currentTime = 40;
    h.engine.pressNext();
    await flush();
    return h;
  }

  it('restarts the story when it has played more than the limit', async () => {
    const h = await onSecond();
    h.storyPlayers[1].currentTime = PREVIOUS_RESTART_AFTER_SEC + 0.5;
    h.storyPlayers[1].status();
    h.engine.pressPrevious();
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.storyPlayers[1].seeks).toEqual([0]);
    expect(h.engine.getView().state.index).toBe(1);
    expect(h.engine.getView().positionSec).toBe(0);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
  });

  it('goes to the previous story from 0 at the limit or earlier, reporting the one it leaves', async () => {
    const h = await onSecond();
    h.storyPlayers[1].currentTime = PREVIOUS_RESTART_AFTER_SEC;
    h.storyPlayers[1].status();
    h.engine.pressPrevious();
    await flush();
    expect(h.storyPlayers[1].removed).toBe(true);
    expect(h.storyPlayers).toHaveLength(3);
    expect(h.storyPlayers[2].url).toBe('https://audio.test/1?old');
    expect(h.storyPlayers[2].seeks).toEqual([]);
    expect(h.storyPlayers[2].playing).toBe(true);
    expect(h.engine.getView().state.index).toBe(0);
    // Story 1 was reported when it was left by «Следующая»; the three seconds of story 2 are too short.
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    // The previous story is a fresh listen: leaving it reports again.
    h.storyPlayers[2].currentTime = 25;
    h.engine.pressNext();
    await flush();
    expect(h.deps.reportListen).toHaveBeenLastCalledWith(ID(1), 25);
  });

  it('goes back to the first story from the second when nothing has played yet', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 2;
    h.engine.pressNext();
    await flush();
    h.engine.pressPrevious();
    await flush();
    expect(h.engine.getView().state.index).toBe(0);
    expect(h.deps.reportListen).not.toHaveBeenCalled();
  });

  it('always restarts the first story', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 1;
    h.storyPlayers[0].status();
    h.engine.pressPrevious();
    expect(h.storyPlayers).toHaveLength(1);
    expect(h.storyPlayers[0].seeks).toEqual([0]);
    expect(h.engine.getView().state.index).toBe(0);
  });

  it('starts the story that just ended again when pressed in the pause after it', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    h.engine.pressNext();
    await flush();
    expect(h.engine.getView().state.index).toBe(1);
    h.storyPlayers[1].finish();
    await flush();
    expect(h.silencePlayers).toHaveLength(2);
    h.engine.pressPrevious();
    await flush();
    expect(h.silencePlayers[1].removed).toBe(true);
    expect(h.storyPlayers).toHaveLength(3);
    expect(h.storyPlayers[2].url).toBe('https://audio.test/2?old');
    expect(h.engine.getView().state.index).toBe(1);
    expect(h.engine.getView().progress).toBe(0);
  });
});

describe('NightEngine: the progress of a story', () => {
  it('is exactly 1 when the story ends, whatever the last native position was', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 120, duration: 183 });
    expect(h.engine.getView().progress).toBeCloseTo(120 / 183);
    h.storyPlayers[0].status({ currentTime: 182.6, duration: 183, didJustFinish: true });
    const view = h.engine.getView();
    expect(view.progress).toBe(1);
    expect(view.positionSec).toBe(view.durationSec);
  });

  it('is drawn against the duration of the playing audio, not the stored one', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 90, duration: 180 });
    const view = h.engine.getView();
    expect(view.durationSec).toBe(180);
    expect(view.progress).toBe(0.5);
  });

  it('uses the stored duration until the player reports one, and never leaves 0 to 1', async () => {
    const h = await started();
    expect(h.engine.getView().durationSec).toBe(185);
    h.storyPlayers[0].status({ currentTime: 200, duration: 0 });
    expect(h.engine.getView().progress).toBe(1);
    expect(h.engine.getView().positionSec).toBe(185);
    h.storyPlayers[0].status({ currentTime: -3, duration: 0 });
    expect(h.engine.getView().progress).toBe(0);
    expect(h.engine.getView().positionSec).toBe(0);
  });

  it('stays full through the pause and resets when the next story starts', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 184.6, duration: 185, didJustFinish: true });
    await flush();
    expect(h.engine.getView().progress).toBe(1);
    expect(h.engine.getView().state.index).toBe(0);
    await endPause(h);
    expect(h.engine.getView().state.index).toBe(1);
    expect(h.engine.getView().progress).toBe(0);
    expect(h.engine.getView().positionSec).toBe(0);
  });
});

describe('NightEngine: the pauses', () => {
  it('runs in order: story ends, silence, next story, and the index moves with the next story', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    expect(h.silencePlayers).toHaveLength(1);
    expect(h.silencePlayers[0].playing).toBe(true);
    expect(h.storyPlayers).toHaveLength(1);
    expect(h.engine.getView().state.index).toBe(0);
    await endPause(h);
    expect(h.silencePlayers[0].removed).toBe(true);
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.engine.getView().state.index).toBe(1);
    const silenceAt = h.deps.createSilencePlayer.mock.invocationCallOrder[0];
    const secondStoryAt = h.deps.createStoryPlayer.mock.invocationCallOrder[1];
    expect(silenceAt).toBeLessThan(secondStoryAt);
  });

  it('runs in order before the waves: last story ends, silence, waves from silence', async () => {
    const h = await started(1);
    h.storyPlayers[0].finish();
    await flush();
    expect(h.deps.createWavesPlayer).not.toHaveBeenCalled();
    await endPause(h);
    expect(h.deps.createWavesPlayer.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.deps.createSilencePlayer.mock.invocationCallOrder[0],
    );
    expect(h.wavesPlayers[0].volume).toBe(0);
  });

  it('uses the same path for «Следующая» on the last story', async () => {
    const h = await started(1);
    h.storyPlayers[0].currentTime = 40;
    h.engine.pressNext();
    await flush();
    expect(h.engine.getView().state.mode).toBe('waves');
    expect(h.silencePlayers).toHaveLength(1);
    expect(h.wavesPlayers).toHaveLength(0);
    await endPause(h);
    expect(h.wavesPlayers).toHaveLength(1);
  });

  it('skips the pause when the person presses «Следующая» between stories', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 40;
    h.engine.pressNext();
    await flush();
    expect(h.silencePlayers).toHaveLength(0);
    expect(h.storyPlayers).toHaveLength(2);
  });

  it('skips the rest of the pause when «Следующая» is pressed in it', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    h.engine.pressNext();
    await flush();
    expect(h.silencePlayers[0].removed).toBe(true);
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.engine.getView().state.index).toBe(1);
    // The finished story was reported once.
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes the silence with the pause button, and the next story waits', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    h.engine.togglePause();
    expect(h.silencePlayers[0].playing).toBe(false);
    h.engine.togglePause();
    expect(h.silencePlayers[0].playing).toBe(true);
  });

  it('continues the night on a touch in the silence before the waves, and the waves never start', async () => {
    const h = await started(1);
    h.storyPlayers[0].finish();
    await flush();
    h.deps.continueNight.mockResolvedValue(continueResponse('ready', [readyItem(1)]));
    h.engine.touch();
    await flush();
    expect(h.deps.continueNight).toHaveBeenCalledTimes(1);
    expect(h.silencePlayers[0].removed).toBe(true);
    expect(h.wavesPlayers).toHaveLength(0);
    expect(h.engine.getView().state).toMatchObject({ mode: 'playing', index: 0 });
  });

  it('does not start the waves when the silence ends while the continue request is in flight', async () => {
    const h = await started(1);
    h.storyPlayers[0].finish();
    await flush();
    let answer: (value: ContinueResponse) => void = () => undefined;
    h.deps.continueNight.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    h.engine.touch();
    await flush();
    await endPause(h);
    expect(h.wavesPlayers).toHaveLength(0);
    answer(continueResponse('none_ready', []));
    await flush();
    expect(h.exits).toEqual(['none-ready']);
  });

  it('goes on at once when the silence cannot be created or fails', async () => {
    const h = await started();
    h.deps.createSilencePlayer.mockImplementationOnce(() => {
      throw new Error('no file');
    });
    h.storyPlayers[0].finish();
    await flush();
    expect(h.storyPlayers).toHaveLength(2);
    expect(h.engine.getView().state.index).toBe(1);

    h.storyPlayers[1].finish();
    await flush();
    h.silencePlayers[0].status({ error: 'broken' });
    await flush();
    expect(h.storyPlayers).toHaveLength(3);
  });

  it('stops the silence and reports nothing twice when the person leaves in a pause', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    h.engine.leave();
    expect(h.silencePlayers[0].removed).toBe(true);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.exits).toEqual(['leave']);
    h.silencePlayers[0].status({ didJustFinish: true });
    await flush();
    expect(h.storyPlayers).toHaveLength(1);
  });

  it('keeps the dimmed look through a pause between stories', async () => {
    const h = await started();
    h.engine.moon();
    h.storyPlayers[0].finish();
    await flush();
    await endPause(h);
    expect(h.engine.getView().state).toMatchObject({ mode: 'dim', index: 1 });
    expect(h.storyPlayers).toHaveLength(2);
  });
});

describe('NightEngine: no timers on the audio path', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not move on from a pause between stories however much timer time passes', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    jest.advanceTimersByTime(10 * 60 * 1000);
    await flush();
    expect(h.storyPlayers).toHaveLength(1);
    expect(h.engine.getView().state.index).toBe(0);
    await endPause(h);
    expect(h.storyPlayers).toHaveLength(2);
  });

  it('does not start the waves from the pause before them however much timer time passes', async () => {
    const h = await started(1);
    h.storyPlayers[0].finish();
    await flush();
    jest.advanceTimersByTime(10 * 60 * 1000);
    await flush();
    expect(h.wavesPlayers).toHaveLength(0);
    await endPause(h);
    expect(h.wavesPlayers).toHaveLength(1);
    // The fade is a function of the native position only.
    jest.advanceTimersByTime(60 * 1000);
    expect(h.wavesPlayers[0].volume).toBe(0);
    h.wavesPlayers[0].status({ currentTime: 10, duration: 20 });
    expect(h.wavesPlayers[0].volume).toBeGreaterThan(0.5);
  });
});

describe('NightEngine: seeking', () => {
  it('seeks the current story natively and moves the position at once', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 10, duration: 180 });
    h.engine.seekTo(90);
    expect(h.storyPlayers[0].seeks).toEqual([90]);
    expect(h.engine.getView().positionSec).toBe(90);
    expect(h.engine.getView().progress).toBe(0.5);
  });

  it('keeps the target inside the story, one second short of its end', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 10, duration: 180 });
    h.engine.seekTo(9999);
    h.engine.seekTo(180);
    h.engine.seekTo(-5);
    expect(h.storyPlayers[0].seeks).toEqual([179, 179, 0]);
    h.engine.seekTo(Number.NaN);
    expect(h.storyPlayers[0].seeks).toHaveLength(3);
  });

  it('is ignored in the pause after a story, in the waves, and before a player exists', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    h.engine.seekTo(50);
    expect(h.storyPlayers[0].seeks).toEqual([]);
    await endPause(h);
    const second = h.storyPlayers[1];
    h.engine.seekTo(50);
    expect(second.seeks).toEqual([50]);

    const w = await started(1);
    await endStoryAndPause(w);
    w.engine.seekTo(50);
    expect(w.storyPlayers[0].seeks).toEqual([]);
    expect(w.wavesPlayers[0].seeks).toEqual([]);

    const early = setup(1, { fetchedAt: 0 });
    early.deps.fetchFreshUrls.mockReturnValue(new Promise(() => undefined));
    void early.engine.start();
    await flush();
    early.engine.seekTo(50);
    expect(early.storyPlayers).toHaveLength(0);
  });

  it('is reported as the position at leave, with no anti-seek rule', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 10, duration: 185 });
    h.engine.seekTo(120);
    h.storyPlayers[0].currentTime = 120;
    h.engine.leave();
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 120);
  });

  it('does not count a jump as recovery after a retry', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 70;
    h.storyPlayers[0].status();
    h.storyPlayers[0].status({ error: 'expired' });
    await flush();
    const retry = h.storyPlayers[1];
    retry.status({ currentTime: 70, duration: 185, playing: true });
    h.engine.seekTo(150);
    retry.status({ currentTime: 150, duration: 185, playing: true });
    retry.status({ error: 'dead' });
    await flush();
    // Not re-armed by the jump: the second error skips the story instead of retrying it again.
    expect(h.engine.getView().state.index).toBe(1);
  });

  it('keeps a seek and a retry together: the retry resumes from the sought position', async () => {
    const h = await started();
    h.storyPlayers[0].status({ currentTime: 10, duration: 185 });
    h.engine.seekTo(100);
    h.storyPlayers[0].status({ currentTime: 100, duration: 185 });
    h.storyPlayers[0].status({ error: 'expired' });
    await flush();
    expect(h.storyPlayers[1].seeks).toEqual([100]);
  });
});

describe('NightEngine: after the person left', () => {
  it('creates and plays no player on «Следующая», «Предыдущая» or a restart', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 40;
    h.storyPlayers[0].status();
    h.engine.leave();
    const created = () =>
      h.storyPlayers.length + h.silencePlayers.length + h.wavesPlayers.length;
    const before = created();
    h.engine.pressNext();
    h.engine.pressPrevious();
    h.engine.togglePause();
    h.engine.moon();
    h.engine.idle();
    h.engine.seekTo(10);
    h.engine.touch();
    await flush();
    expect(created()).toBe(before);
    expect(h.storyPlayers.every((player) => !player.playing)).toBe(true);
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
  });

  it('starts no story on a restart in the pause after the leave', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    h.engine.leave();
    h.engine.pressPrevious();
    await flush();
    expect(h.storyPlayers).toHaveLength(1);
    expect(h.silencePlayers.every((player) => player.removed)).toBe(true);
  });

  it('creates no player when a refresh of the URLs resolves after the leave', async () => {
    const h = setup(2, { fetchedAt: 0 });
    let resolve: (value: ReadonlyMap<string, string> | null) => void = () => undefined;
    h.deps.fetchFreshUrls.mockReturnValue(new Promise((r) => (resolve = r)));
    const starting = h.engine.start();
    await flush();
    h.engine.leave();
    resolve(new Map([[ID(1), 'https://audio.test/1?new']]));
    await starting;
    expect(h.storyPlayers).toHaveLength(0);
  });

  it('plays nothing when «Следующая» was pressed just before the leave and its refresh resolves later', async () => {
    const h = await started();
    h.clock.now += URL_MAX_AGE_MS + 1;
    let resolve: (value: ReadonlyMap<string, string> | null) => void = () => undefined;
    h.deps.fetchFreshUrls.mockReturnValue(new Promise((r) => (resolve = r)));
    h.storyPlayers[0].currentTime = 40;
    h.engine.pressNext();
    await flush();
    h.engine.leave();
    resolve(new Map([[ID(2), 'https://audio.test/2?new']]));
    await flush();
    expect(h.storyPlayers).toHaveLength(1);
  });
});

describe('NightEngine: a seek that has not landed', () => {
  it('ignores the old native positions until the seek lands, then follows them again', async () => {
    const h = await started();
    const player = h.storyPlayers[0];
    player.status({ currentTime: 10, duration: 180 });
    player.holdSeeks = true;
    h.engine.seekTo(100);
    expect(h.engine.getView().positionSec).toBe(100);
    // An update from before the seek: the bar must not jump back.
    player.status({ currentTime: 10.5, duration: 180 });
    expect(h.engine.getView().positionSec).toBe(100);
    // The native position reaches the target.
    player.status({ currentTime: 100.2, duration: 180 });
    expect(h.engine.getView().positionSec).toBeCloseTo(100.2);
    player.status({ currentTime: 101, duration: 180 });
    expect(h.engine.getView().positionSec).toBe(101);
  });

  it('stops ignoring positions when the seek settles', async () => {
    const h = await started();
    const player = h.storyPlayers[0];
    player.status({ currentTime: 10, duration: 180 });
    player.holdSeeks = true;
    h.engine.seekTo(100);
    player.landSeeks();
    await flush();
    player.status({ currentTime: 60, duration: 180 });
    expect(h.engine.getView().positionSec).toBe(60);
  });

  it('applies to a restart as well', async () => {
    const h = await started();
    const player = h.storyPlayers[0];
    player.status({ currentTime: 50, duration: 180 });
    player.holdSeeks = true;
    h.engine.pressPrevious();
    player.status({ currentTime: 50.5, duration: 180 });
    expect(h.engine.getView().positionSec).toBe(0);
  });

  it('still ends the story when it finishes during an unlanded seek', async () => {
    const h = await started();
    const player = h.storyPlayers[0];
    player.holdSeeks = true;
    h.engine.seekTo(100);
    player.status({ currentTime: 184.9, duration: 185, didJustFinish: true });
    await flush();
    expect(h.engine.getView().progress).toBe(1);
    expect(h.silencePlayers).toHaveLength(1);
  });
});

describe('NightEngine: «Предыдущая» after a reported finish', () => {
  it('does not report the restarted play of a story that was reported as finished', async () => {
    const h = await started();
    h.storyPlayers[0].finish();
    await flush();
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    h.engine.pressPrevious();
    await flush();
    expect(h.storyPlayers).toHaveLength(2);
    h.storyPlayers[1].currentTime = 120;
    h.storyPlayers[1].status();
    h.engine.leave();
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
  });

  it('keeps reporting a restart of a story that is still playing as before', async () => {
    const h = await started();
    h.storyPlayers[0].currentTime = 50;
    h.storyPlayers[0].status();
    h.engine.pressPrevious();
    h.storyPlayers[0].currentTime = 30;
    h.storyPlayers[0].status();
    h.engine.leave();
    expect(h.deps.reportListen).toHaveBeenCalledTimes(1);
    expect(h.deps.reportListen).toHaveBeenCalledWith(ID(1), 30);
  });
});

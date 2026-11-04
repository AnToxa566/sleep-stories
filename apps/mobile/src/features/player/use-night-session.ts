import { useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import type { QueueResponse } from '@sleep-stories/contracts';
import { strings } from '../../strings';
import { showToast } from '../../ui/toast-store';
import { useSessionStore } from '../auth/session-store';
import { queueQueryKey } from '../today/queue-cache';
import { topicsUserKey } from '../topics/topic-cache';
import { NightEngine, type NightExit } from './night-engine';
import { fetchFreshAudioUrls, postListenReport, useContinueQueue } from './player-queries';
import { IDLE_DIM_MS, KEEP_AWAKE_MAX_MS, readyStories } from './player-stories';

// Wires the engine to the app: the real audio players, the requests, the query cache, the
// router, the Android back key and the keep-awake lock. The engine itself is plain TypeScript
// and is tested with fakes (night-engine.spec.ts); what is here needs a device.

// The bundled waves sound (20 s, the same for every voice, ARCHITECTURE.md section 7).
const WAVES_SOURCE: number = require('../../../assets/audio/waves.mp3');

// The bundled silent file that makes the pauses (3 s, SILENCE_FILE_SEC): 8000 Hz, 16-bit, mono PCM
// WAV, all zero samples, with a 44-byte header (about 47 KB). Made with a throwaway Node script
// (no ffmpeg): write the header, then 24000 zero samples. It is played by a native player and its
// `didJustFinish` ends the pause, so the pauses run with the screen off (see night-engine.ts).
const SILENCE_SOURCE: number = require('../../../assets/audio/silence-3s.wav');

// How often native playback reports its position. The waves report faster so that the fade and
// the countdown of 3c move smoothly; both are native events, not timers.
const STORY_UPDATE_MS = 500;
const WAVES_UPDATE_MS = 250;

// One lock for the whole player, always released with the same tag.
const KEEP_AWAKE_TAG = 'night-playback';

// Starts the night from the queue that «Сегодня» holds in the query cache, and returns the
// engine once it exists. Returns null before that, and when the cache holds no ready story (a
// cold start straight into the player route), in which case the screen goes back to «Сегодня».
export function useNightSession(): NightEngine | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.userId);
  const continueQueue = useContinueQueue();
  const [engine, setEngine] = useState<NightEngine | null>(null);

  const goToToday = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  // The latest closures for the engine, which is created once.
  const latest = useRef({ goToToday, continueAsync: continueQueue.mutateAsync, userId, queryClient });
  useEffect(() => {
    latest.current = { goToToday, continueAsync: continueQueue.mutateAsync, userId, queryClient };
  }, [goToToday, continueQueue.mutateAsync, userId, queryClient]);

  useEffect(() => {
    const queue = queryClient.getQueryData<QueueResponse>(queueQueryKey(userId));
    // Age unknown (0): the engine reads the queue once before the first story, so a URL that
    // sat in the cache for half an hour is never played.
    const stories = readyStories(queue?.items ?? [], 0);
    if (stories.length === 0) {
      latest.current.goToToday();
      return;
    }

    // Plays in the silent mode of iOS and keeps going with the screen off. Sustained background
    // playback on Android needs the lock-screen control of the story player (night-engine.ts) and
    // the `expo-audio` config plugin in app.json; the control needs `doNotMix` (expo-audio docs):
    // other apps' audio stops while the night plays. A device test is still to be done
    // (ARCHITECTURE.md section 11, item 1).
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);

    let exited = false;
    const created: NightEngine = new NightEngine(
      {
        createStoryPlayer: (url) => createAudioPlayer({ uri: url }, { updateInterval: STORY_UPDATE_MS }),
        lockScreenMetadata: (story) => ({ title: story.title, artist: strings.auth.appName }),
        createWavesPlayer: () => createAudioPlayer(WAVES_SOURCE, { updateInterval: WAVES_UPDATE_MS }),
        createSilencePlayer: () => createAudioPlayer(SILENCE_SOURCE, { updateInterval: WAVES_UPDATE_MS }),
        reportListen: postListenReport,
        fetchFreshUrls: fetchFreshAudioUrls,
        continueNight: () => latest.current.continueAsync(),
        now: () => Date.now(),
        onExit: (exit) => {
          exited = true;
          handleExit(exit, created, latest.current);
        },
      },
      stories,
    );
    setEngine(created);
    void created.start();
    return () => {
      created.dispose();
      // The screen went away without a way out of the engine (a gesture, a navigation): the
      // listens are still recorded and «Сегодня» still needs the heard marks.
      if (!exited) refreshAfterNight(created, latest.current);
      setEngine(null);
    };
    // The night starts once per mount; the closures above read `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Android back key behaves exactly like the arrow: it stops the audio, reports the listen
  // and goes to «Сегодня».
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (engine !== null) engine.leave();
      else goToToday();
      return true;
    });
    return () => subscription.remove();
  }, [engine, goToToday]);

  return engine;
}

type Latest = {
  goToToday: () => void;
  userId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
};

// Where each way of ending the night goes: always «Сегодня». The toast is put in the store first
// and shows when «Сегодня» is on screen again (its host mounts on focus). «Сегодня» then shows
// the heard marks, which come from the listens, so the queue and the topics are read once more
// after the last report has landed (not on «none-ready», whose answer already set the queue and
// refreshed the topics, after the same wait).
function handleExit(exit: NightExit, engine: NightEngine, latest: Latest): void {
  if (exit === 'none-ready') showToast({ label: strings.player.noneReady });
  if (exit === 'error') showToast({ label: strings.today.errors.generic });
  latest.goToToday();
  if (exit === 'none-ready') return;
  refreshAfterNight(engine, latest);
}

function refreshAfterNight(engine: NightEngine, latest: Latest): void {
  void engine.whenListensRecorded().then(() =>
    Promise.all([
      latest.queryClient.invalidateQueries({ queryKey: queueQueryKey(latest.userId) }),
      latest.queryClient.invalidateQueries({ queryKey: topicsUserKey(latest.userId) }),
    ]),
  );
}

// The interface goes near-black after IDLE_DIM_MS without a touch while the player view is
// shown. A JS timer, on purpose: it matters only while the screen is on (the screen is kept on
// by the lock below), and nothing about the audio depends on it. Call the returned function on
// every touch.
export function useIdleDim(engine: NightEngine, playerViewShown: boolean): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `playerViewShown` is false while the story is paused: a touch must not arm the timer then.
  const shown = useRef(playerViewShown);
  shown.current = playerViewShown;
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const arm = useCallback(() => {
    clear();
    if (!shown.current) return;
    timer.current = setTimeout(() => engine.idle(), IDLE_DIM_MS);
  }, [clear, engine]);

  useEffect(() => {
    if (playerViewShown) arm();
    else clear();
    return clear;
  }, [playerViewShown, arm, clear]);

  return arm;
}

// Keeps the screen on while `active` (the player is mounted and not asleep) and the app is in
// the foreground; releases the lock on the asleep screen, when the app leaves the foreground,
// when the screen unmounts and after KEEP_AWAKE_MAX_MS whatever else happens
// (ARCHITECTURE.md section 7, "Releasing the screen must not be forgotten"). The activity can
// be missing for a moment (the native call throws), which must not break the player.
export function useNightKeepAwake(active: boolean): void {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), KEEP_AWAKE_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  const hold = active && foreground && !expired;
  useEffect(() => {
    if (!hold) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [hold]);
}

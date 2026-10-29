import { AppState, Platform } from 'react-native';
import {
  createAudioPlayer,
  createAudioPlaylist,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioMode,
  type AudioPlayer,
  type AudioPlaylist,
  type AudioPlaylistStatus,
  type AudioRecorder,
  type AudioStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';

import { VoiceDetector, type DetectorResult } from './detector';
import { log, logError, markNightStart } from './logger';
import { EXTRA_TRACK, METRONOME_TRACK, PROMPT_TRACK, QUEUE_TRACKS, type Track } from './tracks';

// Throwaway spike code. One class runs the whole night so every event is logged from one place.
//
// Night flow: queue of 3 tracks -> «Вы спите?» prompt -> listening window (level only) ->
//   answer:  extra track plays (recording audio mode is switched back to playback mid-track)
//   silence: extra track plays and is faded out over 10 s, then stop
// Nothing here touches the network. Microphone audio is only metered on the device and the recording
// file is deleted on stop.

export type RecordingMode = 'start' | 'end';
// 'sequential': one AudioPlayer per track. Needed for lock-screen controls, because AudioPlaylist
// has no lock-screen API in expo-audio 56 or 57.
// 'playlist': AudioPlaylist, to measure gapless behaviour. No lock-screen controls in this engine.
export type QueueEngine = 'sequential' | 'playlist';

export type NightConfig = {
  recordingMode: RecordingMode;
  engine: QueueEngine;
  thresholdDb: number;
  minDurationMs: number;
  windowSec: number;
};

export type Phase =
  | 'idle'
  | 'preparing'
  | 'queue'
  | 'prompt'
  | 'listening'
  | 'extra'
  | 'fadeout'
  | 'done';

export type NightState = {
  phase: Phase;
  detail: string;
  levelDb: number | null;
  ambientDb: number | null;
};

const CALIBRATION_MS = 2000;
const POST_PROMPT_DELAY_MS = 500;
const METER_POLL_MS = 100;
const METER_LOG_MS = 250;
const HEARTBEAT_MS = 15000;
const FADE_MS = 10000;
const FADE_STEP_MS = 250;
const RESTORE_MODE_AFTER_MS = 10000;
const PLAYER_UPDATE_MS = 100;
const PUMP_INTERVAL_MS = 50;
const LATE_LOG_MS = 400;
// iOS: without this, expo-audio deactivates the AVAudioSession 100 ms after any player finishes
// (it only looks at players, not at the recorder), which would stop a running recorder and make the
// session unavailable when recording is switched on from the background. AudioPlaylist has no such
// option, so the playlist engine on iOS may still lose the session between tracks.
const PLAYER_OPTIONS = { updateInterval: PLAYER_UPDATE_MS, keepAudioSessionActive: true };

const PLAYBACK_MODE: Partial<AudioMode> = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
  allowsRecording: false,
  allowsBackgroundRecording: false,
};

const RECORDING_MODE: Partial<AudioMode> = {
  ...PLAYBACK_MODE,
  allowsRecording: true,
  allowsBackgroundRecording: true,
};

// JS timers (setTimeout/setInterval) stop firing while the Android app is in the background (seen on a
// real run: the 500 ms delay after the prompt did not fire until the screen was woken, 44 s later).
// Native player status updates do keep reaching JS. So every deadline lives in `jobs`, and `pump()`
// runs the due ones. It is called from a normal interval (foreground) and from every native player
// status update, including a silent looping "metronome" player during the listening window.
type Job = { id: number; label: string; at: number; every: number | null; fn: () => void | Promise<void> };

type PlayerLogState = { playing: boolean | null; buffering: boolean | null; tenSecBucket: number };

export function watchAppState(): () => void {
  log('APP', `initial state: ${AppState.currentState}`);
  const subscription = AppState.addEventListener('change', (next) => {
    log('APP', `state -> ${next}`);
  });
  return () => subscription.remove();
}

export class NightController {
  private runId = 0;
  private config: NightConfig | null = null;
  private phase: Phase = 'idle';
  private levelDb: number | null = null;
  private ambientDb: number | null = null;

  private trackPlayers: AudioPlayer[] = [];
  private playlist: AudioPlaylist | null = null;
  private promptPlayer: AudioPlayer | null = null;
  private extraPlayer: AudioPlayer | null = null;
  private subscriptions: { remove(): void }[] = [];
  private jobs: Job[] = [];
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private metronome: AudioPlayer | null = null;
  private metronomePlaying = false;
  private backgroundPumpLogged = false;
  private pumping = false;

  private recording = false;
  private tearingDown = false;
  private currentTrack = -1;
  private trackFinished: boolean[] = [];
  private gapStartedAt: number | null = null;
  private queueEnded = false;
  private promptFinished = false;
  private extraFinished = false;
  private lastPlaylistPlayingAt: { index: number; at: number } | null = null;
  private playerLog = new Map<string, PlayerLogState>();
  private lastPlayerError = new Map<string, string>();

  private detector: VoiceDetector | null = null;
  private windowStartedAt = 0;
  private lastMeterLogAt = 0;
  private meteringMissing = 0;

  private summary: string[] = [];
  private lastDetail = '';

  constructor(
    private readonly recorder: AudioRecorder,
    private readonly onState: (state: NightState) => void,
  ) {}

  get running(): boolean {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  async start(config: NightConfig) {
    if (this.running) return;
    this.runId += 1;
    const id = this.runId;
    this.config = config;
    this.resetRunState();
    markNightStart();
    this.setPhase('preparing', 'requesting permissions');
    log(
      'APP',
      `night start: ${Platform.OS} ${String(Platform.Version)} app=${AppState.currentState} config=${JSON.stringify(config)}`,
    );

    try {
      const rec = await requestRecordingPermissionsAsync();
      log('REC', `microphone permission: status=${rec.status} granted=${rec.granted}`);
      if (Platform.OS === 'android') {
        try {
          const notif = await requestNotificationPermissionsAsync();
          log('REC', `notification permission: status=${notif.status} granted=${notif.granted}`);
        } catch (e) {
          logError('notification permission', e);
        }
      }
      if (id !== this.runId) return;

      await this.applyMode('playback', PLAYBACK_MODE);
      if (config.recordingMode === 'start') {
        await this.applyMode('recording (night start)', RECORDING_MODE);
        await this.startRecorder('night start', id);
      }
      if (id !== this.runId) return;

      this.createPlayers(id);
      this.pumpTimer = setInterval(() => this.pump('interval'), PUMP_INTERVAL_MS);
      this.startHeartbeat(id);
      this.startQueue(id);
    } catch (e) {
      logError('start', e);
      await this.teardown('error during start');
    }
  }

  async stop() {
    if (this.phase === 'idle') return;
    await this.teardown('stopped by user');
  }

  // ---------------------------------------------------------------- audio mode and recorder

  private async applyMode(label: string, mode: Partial<AudioMode>) {
    const began = Date.now();
    log('MODE', `apply "${label}" ${JSON.stringify(mode)} app=${AppState.currentState}`);
    try {
      await setAudioModeAsync(mode);
      log('MODE', `"${label}" applied in ${Date.now() - began}ms`);
    } catch (e) {
      logError(`setAudioModeAsync "${label}"`, e);
    }
  }

  private async startRecorder(reason: string, id: number): Promise<boolean> {
    const began = Date.now();
    log('REC', `start recorder (${reason}) app=${AppState.currentState}`);
    try {
      await this.recorder.prepareToRecordAsync();
      log('REC', `prepared in ${Date.now() - began}ms`);
      if (id !== this.runId) {
        // Stop was pressed while the recorder was preparing: do not leave it prepared or recording.
        this.recording = true;
        await this.stopRecorder();
        return false;
      }
      this.recorder.record();
      this.recording = true;
      const status = this.recorder.getStatus();
      log(
        'REC',
        `record() called, ${Date.now() - began}ms after start; isRecording=${status.isRecording} canRecord=${status.canRecord} metering=${String(status.metering)}`,
      );
      return true;
    } catch (e) {
      logError(`start recorder (${reason})`, e);
      return false;
    }
  }

  private async stopRecorder() {
    if (!this.recording) return;
    this.recording = false;
    try {
      await this.recorder.stop();
      log('REC', 'recorder stopped');
    } catch (e) {
      logError('stop recorder', e);
    }
    // The recording only exists to make metering possible. Delete it; it never leaves the device.
    try {
      const uri = this.recorder.uri;
      if (uri) {
        const file = new File(uri);
        if (file.exists) file.delete();
        log('REC', 'recording file deleted');
      }
    } catch (e) {
      logError('delete recording file', e);
    }
  }

  // ---------------------------------------------------------------- queue

  private createPlayers(id: number) {
    if (this.config?.engine === 'sequential') {
      this.trackPlayers = QUEUE_TRACKS.map((track, index) => {
        const player = createAudioPlayer(track.source, PLAYER_OPTIONS);
        this.subscriptions.push(
          player.addListener('playbackStatusUpdate', (status) =>
            this.onTrackStatus(id, index, status),
          ),
        );
        return player;
      });
    } else {
      this.playlist = createAudioPlaylist({
        sources: QUEUE_TRACKS.map((track) => track.source),
        updateInterval: PLAYER_UPDATE_MS,
        loop: 'none',
      });
      this.subscriptions.push(
        this.playlist.addListener('trackChanged', (data) => {
          log(
            'TRACK',
            `trackChanged ${data.previousIndex + 1} -> ${data.currentIndex + 1} app=${AppState.currentState}`,
          );
        }),
        this.playlist.addListener('playlistStatusUpdate', (status) =>
          this.onPlaylistStatus(id, status),
        ),
      );
    }

    // Prompt and extra players are created and loaded up front, so nothing has to load while the
    // app may be in the background.
    this.promptPlayer = createAudioPlayer(PROMPT_TRACK.source, PLAYER_OPTIONS);
    this.subscriptions.push(
      this.promptPlayer.addListener('playbackStatusUpdate', (status) =>
        this.onPromptStatus(id, status),
      ),
    );
    this.extraPlayer = createAudioPlayer(EXTRA_TRACK.source, PLAYER_OPTIONS);
    this.subscriptions.push(
      this.extraPlayer.addListener('playbackStatusUpdate', (status) =>
        this.onExtraStatus(id, status),
      ),
    );
    this.metronome = createAudioPlayer(METRONOME_TRACK.source, PLAYER_OPTIONS);
    this.metronome.loop = true;
    this.subscriptions.push(
      this.metronome.addListener('playbackStatusUpdate', (status) => {
        if (id !== this.runId) return;
        this.metronomePlaying = status.playing;
        this.pump('event');
      }),
    );
    log('TRACK', `players created, engine=${this.config?.engine} keepAudioSessionActive=${PLAYER_OPTIONS.keepAudioSessionActive}`);
  }

  private startQueue(id: number) {
    this.setPhase('queue', 'track 1');
    if (this.config?.engine === 'sequential') {
      this.playSequentialTrack(id, 0);
    } else {
      log('TRACK', 'playlist engine: AudioPlaylist has no lock-screen API, so no lock-screen controls');
      this.gapStartedAt = null;
      this.safePlay('playlist', () => this.playlist?.play());
      log('TRACK', 'playlist.play() called');
    }
  }

  private playSequentialTrack(id: number, index: number) {
    if (id !== this.runId) return;
    const player = this.trackPlayers[index];
    const track = QUEUE_TRACKS[index];
    this.currentTrack = index;
    this.setPhase('queue', `track ${index + 1}/${QUEUE_TRACKS.length}`);
    this.activateLockScreen(player, track);
    this.safePlay(`track ${index + 1}`, () => player.play());
    log('TRACK', `track ${index + 1} play() called app=${AppState.currentState}`);
  }

  // play() turns the iOS audio session on and can throw from the background. These calls run inside
  // native event listeners, so an uncaught error would end the night with nothing in the log.
  private safePlay(label: string, play: () => void) {
    try {
      play();
    } catch (e) {
      logError(`play ${label}`, e);
    }
  }

  private activateLockScreen(player: AudioPlayer, track: Track) {
    try {
      player.setActiveForLockScreen(true, {
        title: track.title,
        artist: 'Sleep Stories spike',
        albumTitle: 'Spike',
      });
      log('TRACK', `lock screen active for "${track.title}"`);
    } catch (e) {
      logError(`setActiveForLockScreen "${track.title}"`, e);
    }
  }

  private logPlayerChange(
    key: string,
    status: {
      playing: boolean;
      isBuffering: boolean;
      currentTime: number;
      duration: number;
      error?: string | null;
    },
    label: string,
  ) {
    if (status.error && status.error !== this.lastPlayerError.get(key)) {
      this.lastPlayerError.set(key, status.error);
      log('ERR', `${label} playback error: ${status.error}`);
    }
    const previous = this.playerLog.get(key) ?? {
      playing: null,
      buffering: null,
      tenSecBucket: -1,
    };
    const bucket = Math.floor(status.currentTime / 10);
    const changed = previous.playing !== status.playing || previous.buffering !== status.isBuffering;
    if (changed || bucket !== previous.tenSecBucket) {
      log(
        'TRACK',
        `${label} playing=${status.playing} buffering=${status.isBuffering} t=${status.currentTime.toFixed(1)}/${status.duration.toFixed(1)}s app=${AppState.currentState}`,
      );
    }
    this.playerLog.set(key, {
      playing: status.playing,
      buffering: status.isBuffering,
      tenSecBucket: bucket,
    });
  }

  private onTrackStatus(id: number, index: number, status: AudioStatus) {
    if (id !== this.runId) return;
    this.pump('event');
    this.logPlayerChange(`track${index}`, status, `track ${index + 1}`);

    if (status.playing && this.gapStartedAt !== null && index === this.currentTrack) {
      const gap = Date.now() - this.gapStartedAt;
      this.gapStartedAt = null;
      this.summary.push(`gap ${index}->${index + 1}: ${gap}ms`);
      log('GAP', `track ${index} end -> track ${index + 1} first playing status: ${gap}ms (JS clock, sequential engine)`);
    }

    if (status.didJustFinish && !this.trackFinished[index]) {
      this.trackFinished[index] = true;
      log('TRACK', `track ${index + 1} finished app=${AppState.currentState}`);
      if (index + 1 < QUEUE_TRACKS.length) {
        this.gapStartedAt = Date.now();
        this.playSequentialTrack(id, index + 1);
      } else {
        this.onQueueEnded(id);
      }
    }
  }

  private onPlaylistStatus(id: number, status: AudioPlaylistStatus) {
    if (id !== this.runId) return;
    this.pump('event');
    this.logPlayerChange('playlist', status, `playlist track ${status.currentIndex + 1}`);

    const last = this.lastPlaylistPlayingAt;
    if (status.playing) {
      if (last && last.index !== status.currentIndex) {
        const gap = Date.now() - last.at;
        this.summary.push(`gap ${last.index + 1}->${status.currentIndex + 1}: ${gap}ms`);
        log(
          'GAP',
          `playlist: last playing status of track ${last.index + 1} -> first playing status of track ${status.currentIndex + 1}: ${gap}ms (JS clock, includes up to ${PLAYER_UPDATE_MS}ms update interval)`,
        );
      }
      this.lastPlaylistPlayingAt = { index: status.currentIndex, at: Date.now() };
      this.currentTrack = status.currentIndex;
      this.setPhase('queue', `track ${status.currentIndex + 1}/${QUEUE_TRACKS.length}`);
    }

    if (status.didJustFinish && status.currentIndex === QUEUE_TRACKS.length - 1) {
      this.onQueueEnded(id);
    }
  }

  // ---------------------------------------------------------------- prompt

  private onQueueEnded(id: number) {
    if (this.queueEnded || id !== this.runId) return;
    this.queueEnded = true;
    log('TRACK', `queue ended app=${AppState.currentState}`);
    this.setPhase('prompt', 'Вы спите?');
    const player = this.promptPlayer;
    if (!player) return;
    // No timer between the last track ending and the prompt starting: iOS may suspend the app.
    this.activateLockScreen(player, PROMPT_TRACK);
    this.safePlay('prompt', () => player.play());
    log('TRACK', 'prompt play() called');
  }

  private onPromptStatus(id: number, status: AudioStatus) {
    if (id !== this.runId) return;
    this.pump('event');
    this.logPlayerChange('prompt', status, 'prompt');
    if (status.didJustFinish && !this.promptFinished) {
      this.promptFinished = true;
      log('TRACK', `prompt finished, listening starts in ${POST_PROMPT_DELAY_MS}ms app=${AppState.currentState}`);
      // The metronome keeps native status updates (and so the scheduler) running while nothing audible plays.
      this.startMetronome();
      this.later(id, 'post-prompt delay', POST_PROMPT_DELAY_MS, () => this.startListening(id));
    }
  }

  // ---------------------------------------------------------------- listening

  private async startListening(id: number) {
    const config = this.config;
    if (!config || id !== this.runId) return;
    this.setPhase('listening', 'preparing microphone');

    if (config.recordingMode === 'end') {
      await this.applyMode('recording (end of night)', RECORDING_MODE);
      await this.startRecorder('end of night', id);
    } else {
      const status = this.recorder.getStatus();
      log('REC', `recorder from night start: isRecording=${status.isRecording} metering=${String(status.metering)}`);
    }
    if (id !== this.runId) return;

    this.windowStartedAt = Date.now();
    this.detector = new VoiceDetector(
      {
        thresholdDb: config.thresholdDb,
        minDurationMs: config.minDurationMs,
        windowMs: config.windowSec * 1000,
        calibrationMs: CALIBRATION_MS,
      },
      this.windowStartedAt,
    );
    this.meteringMissing = 0;
    this.lastMeterLogAt = 0;
    this.setPhase('listening', `window ${config.windowSec}s`);
    log(
      'DETECT',
      `window start: ${config.windowSec}s calibration=${CALIBRATION_MS}ms threshold=+${config.thresholdDb}dB min=${config.minDurationMs}ms recording=${this.recording} app=${AppState.currentState}`,
    );

    this.every(id, 'meter poll', METER_POLL_MS, () => this.pollMeter(id));
    // Safety net: if no sample arrives, the window still ends.
    this.later(id, 'window end', config.windowSec * 1000 + 300, () => {
      if (this.detector && !this.detector.done) return this.finishListening(id, this.detector.expire());
    });
  }

  private pollMeter(id: number) {
    const detector = this.detector;
    if (!detector || detector.done || id !== this.runId) return;
    const now = Date.now();
    let metering: number | undefined;
    try {
      metering = this.recorder.getStatus().metering;
    } catch (e) {
      logError('getStatus', e);
    }

    if (metering === undefined) {
      this.meteringMissing += 1;
      if (this.meteringMissing === 1 || this.meteringMissing % 50 === 0) {
        log('METER', `no metering value (count=${this.meteringMissing}) recording=${this.recording}`);
      }
      return;
    }

    const result = detector.feed(now, metering);
    this.levelDb = metering;
    this.ambientDb = detector.ambient;
    if (now - this.lastMeterLogAt >= METER_LOG_MS) {
      this.lastMeterLogAt = now;
      log(
        'METER',
        `t=${now - this.windowStartedAt}ms level=${metering.toFixed(1)}dB ambient=${detector.ambient === null ? 'calibrating' : detector.ambient.toFixed(1)}dB app=${AppState.currentState}`,
      );
      this.emit();
    }
    if (result) {
      this.finishListening(id, result).catch((e) => logError('finishListening', e));
    }
  }

  private async finishListening(id: number, result: DetectorResult) {
    if (id !== this.runId || this.phase !== 'listening') return;
    this.jobs = [];
    this.restartHeartbeat(id);
    this.levelDb = null;
    log(
      'DETECT',
      `result: ${result.outcome}${this.recording ? '' : ' (recorder was not running)'} ambient=${result.ambientDb?.toFixed(1) ?? 'n/a'}dB peak=${result.peakDb?.toFixed(1) ?? 'n/a'}dB detectedAt=${result.detectedAtMs ?? 'n/a'}ms samples=${result.samples}`,
    );
    this.summary.push(
      `detect: ${result.outcome} ambient=${result.ambientDb?.toFixed(1) ?? 'n/a'} peak=${result.peakDb?.toFixed(1) ?? 'n/a'} samples=${result.samples}`,
    );

    await this.stopRecorder();
    if (id !== this.runId) return;
    // Silence (or a recorder that never started) goes to the fade-out path.
    this.playExtra(id, result.outcome !== 'answer');
    // After play(): audio focus belongs to the app, so pausing the metronome last never gives it up.
    this.stopMetronome();
  }

  // ---------------------------------------------------------------- extra track and fade-out

  private playExtra(id: number, fade: boolean) {
    const player = this.extraPlayer;
    if (!player || id !== this.runId) return;
    this.setPhase(fade ? 'fadeout' : 'extra', fade ? 'silence: fading out' : 'answer: extra track');
    // The audio mode is deliberately left as it is (recording mode if it was switched on), so the
    // owner can hear whether routing or volume changed. It is switched back to playback below.
    this.activateLockScreen(player, EXTRA_TRACK);
    player.volume = 1;
    this.safePlay('extra', () => player.play());
    log('TRACK', `extra track play() called (${fade ? 'will fade out over 10s' : 'answer path'}) app=${AppState.currentState}`);

    if (fade) {
      const began = Date.now();
      let lastLogged = -1;
      this.every(id, 'fade', FADE_STEP_MS, () => {
        const elapsed = Date.now() - began;
        const volume = Math.max(0, 1 - elapsed / FADE_MS);
        player.volume = volume;
        const bucket = Math.floor(elapsed / 2000);
        if (bucket !== lastLogged) {
          lastLogged = bucket;
          log('TRACK', `fade volume=${volume.toFixed(2)} elapsed=${elapsed}ms`);
        }
        if (elapsed >= FADE_MS) {
          log('TRACK', `fade finished after ${elapsed}ms (target ${FADE_MS}ms), pausing`);
          this.summary.push(`fade took ${elapsed}ms`);
          player.pause();
          void this.teardown('fade-out complete');
        }
      });
    } else {
      this.later(id, 'restore playback mode', RESTORE_MODE_AFTER_MS, async () => {
        log('MODE', 'restoring playback mode while the extra track is playing: listen for a route or volume change');
        await this.applyMode('playback (restored mid-track)', PLAYBACK_MODE);
      });
    }
  }

  private onExtraStatus(id: number, status: AudioStatus) {
    if (id !== this.runId) return;
    this.pump('event');
    this.logPlayerChange('extra', status, 'extra');
    if (status.didJustFinish && !this.extraFinished) {
      this.extraFinished = true;
      log('TRACK', 'extra track finished');
      void this.teardown('night complete');
    }
  }

  // ---------------------------------------------------------------- heartbeat, timers, teardown

  private startHeartbeat(id: number) {
    this.every(id, 'heartbeat', HEARTBEAT_MS, () => {
      let rec = 'n/a';
      try {
        const status = this.recorder.getStatus();
        rec = `isRecording=${status.isRecording} metering=${String(status.metering)}`;
      } catch {
        rec = 'getStatus failed';
      }
      log('HEARTBEAT', `phase=${this.phase} app=${AppState.currentState} ${rec}`);
    });
  }

  private restartHeartbeat(id: number) {
    // finishListening cleared every job, including the heartbeat; add it again for the rest of the night.
    this.startHeartbeat(id);
  }

  private every(id: number, label: string, ms: number, fn: Job['fn']) {
    this.jobs.push({ id, label, at: Date.now() + ms, every: ms, fn });
  }

  private later(id: number, label: string, ms: number, fn: Job['fn']) {
    this.jobs.push({ id, label, at: Date.now() + ms, every: null, fn });
  }

  // Runs every job that is due. Safe to call from anywhere and as often as needed.
  private pump(source: 'interval' | 'event') {
    if (this.pumping || this.jobs.length === 0) return;
    this.pumping = true;
    try {
      if (source === 'event' && !this.backgroundPumpLogged && AppState.currentState !== 'active') {
        this.backgroundPumpLogged = true;
        log('TIMER', `scheduler is being driven by native player events while app=${AppState.currentState}`);
      }
      const now = Date.now();
      const due = this.jobs.filter((job) => job.at <= now);
      for (const job of due) {
        if (job.id !== this.runId) {
          this.jobs = this.jobs.filter((other) => other !== job);
          continue;
        }
        const late = now - job.at;
        if (late > LATE_LOG_MS) {
          log('TIMER', `job "${job.label}" ran ${late}ms late via ${source} app=${AppState.currentState}`);
        }
        if (job.every === null) this.jobs = this.jobs.filter((other) => other !== job);
        else job.at = now + job.every;
        try {
          const result = job.fn();
          if (result instanceof Promise) result.catch((e) => logError(`job "${job.label}"`, e));
        } catch (e) {
          logError(`job "${job.label}"`, e);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private startMetronome() {
    const metronome = this.metronome;
    if (!metronome) return;
    this.safePlay('metronome', () => metronome.play());
    log('TIMER', `metronome play() called app=${AppState.currentState}`);
  }

  private stopMetronome() {
    try {
      this.metronome?.pause();
      log('TIMER', `metronome paused (was playing=${this.metronomePlaying})`);
    } catch (e) {
      logError('metronome.pause', e);
    }
  }

  private async teardown(reason: string) {
    if (this.phase === 'idle' || this.phase === 'done' || this.tearingDown) return;
    this.tearingDown = true;
    log('APP', `teardown: ${reason} app=${AppState.currentState}`);
    this.runId += 1; // invalidates every pending callback
    this.jobs = [];
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    this.detector = null;
    await this.stopRecorder();

    this.subscriptions.forEach((s) => {
      try {
        s.remove();
      } catch {
        // already removed
      }
    });
    this.subscriptions = [];
    for (const player of [...this.trackPlayers, this.promptPlayer, this.extraPlayer, this.metronome]) {
      if (!player) continue;
      try {
        player.pause();
        player.clearLockScreenControls();
      } catch {
        // the player may not own the lock screen
      }
      try {
        player.remove();
        // remove() only unregisters; release() frees the native object (and the Android MediaSession).
        player.release();
      } catch (e) {
        logError('player.remove/release', e);
      }
    }
    try {
      this.playlist?.destroy();
      this.playlist?.release();
    } catch (e) {
      logError('playlist.destroy', e);
    }
    this.trackPlayers = [];
    this.playlist = null;
    this.promptPlayer = null;
    this.extraPlayer = null;
    this.metronome = null;
    this.metronomePlaying = false;

    await this.applyMode('playback (teardown)', PLAYBACK_MODE);
    log('SUMMARY', `${reason}; ${this.summary.join('; ') || 'no measurements'}`);
    this.levelDb = null;
    this.ambientDb = null;
    this.setPhase('done', reason);
    this.tearingDown = false;
  }

  private resetRunState() {
    this.jobs = [];
    this.backgroundPumpLogged = false;
    this.pumping = false;
    this.trackPlayers = [];
    this.playlist = null;
    this.currentTrack = -1;
    this.trackFinished = [];
    this.gapStartedAt = null;
    this.queueEnded = false;
    this.promptFinished = false;
    this.extraFinished = false;
    this.lastPlaylistPlayingAt = null;
    this.playerLog = new Map();
    this.lastPlayerError = new Map();
    this.detector = null;
    this.levelDb = null;
    this.ambientDb = null;
    this.summary = [];
    this.recording = false;
  }

  private setPhase(phase: Phase, detail: string) {
    this.phase = phase;
    this.lastDetail = detail;
    this.emit();
  }

  private emit() {
    this.onState({
      phase: this.phase,
      detail: this.lastDetail,
      levelDb: this.levelDb,
      ambientDb: this.ambientDb,
    });
  }
}

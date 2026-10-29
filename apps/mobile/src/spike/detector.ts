// Level-only answer detector. Pure TypeScript: no React Native imports, so it can be run under Node.
// Rule: calibrate the ambient level during the first `calibrationMs` of the window, then an answer is
// "level above ambient + thresholdDb for at least minDurationMs in a row".
// The ambient level is the 10th percentile of the calibration samples (the quiet floor), so speech or
// a noise burst during most of the calibration does not become the "background". A plain mean did
// exactly that on a real run: -21.8 dB calibrated against a -50 dB floor. The cost: a noisy room's
// floor is estimated low, so loud noise bursts can look like answers; the threshold on screen is
// what trades that off.
// No speech recognition; nothing leaves the device.

export type DetectorConfig = {
  thresholdDb: number;
  minDurationMs: number;
  windowMs: number;
  calibrationMs: number;
};

export type DetectorResult = {
  outcome: 'answer' | 'silence';
  ambientDb: number | null;
  peakDb: number | null;
  // Window-relative time of the detection, null for silence.
  detectedAtMs: number | null;
  samples: number;
};

// Android reports -160 for "amplitude 0". Clamping keeps one digital-silence sample from dragging
// the calibration to -160. The raw values are still logged by the caller.
const LEVEL_FLOOR_DB = -100;
// The recorder's first samples after record() can be artificially low (a real Android run logged
// -41 dB first, then -22 dB). They are left out of the calibration so the quiet floor is not
// underestimated; they still count towards the peak and the sample count.
const CALIBRATION_WARMUP_MS = 500;

export class VoiceDetector {
  private calibrationSamples: number[] = [];
  private calibrationSeen = 0;
  private ambientDb: number | null = null;
  private peakDb: number | null = null;
  private aboveSinceMs: number | null = null;
  private samples = 0;
  private result: DetectorResult | null = null;

  constructor(
    private readonly config: DetectorConfig,
    private readonly startMs: number,
  ) {}

  get ambient(): number | null {
    return this.ambientDb;
  }

  get done(): boolean {
    return this.result !== null;
  }

  // Returns the result once the detector has decided, otherwise null.
  feed(nowMs: number, rawLevelDb: number): DetectorResult | null {
    if (this.result) return this.result;
    if (!Number.isFinite(rawLevelDb)) return null;

    const elapsed = nowMs - this.startMs;
    const level = Math.max(rawLevelDb, LEVEL_FLOOR_DB);
    this.samples += 1;
    this.peakDb = this.peakDb === null ? level : Math.max(this.peakDb, level);

    if (elapsed < this.config.calibrationMs) {
      // Floor samples (Android digital silence, -160) are left out of the calibration so a single one does
      // not drag the ambient level down; if every sample is a floor sample the ambient is the floor.
      if (rawLevelDb > LEVEL_FLOOR_DB && elapsed >= CALIBRATION_WARMUP_MS) {
        this.calibrationSamples.push(level);
      }
      this.calibrationSeen += 1;
    } else {
      if (this.ambientDb === null) {
        // No sample arrived during calibration (for example a late first sample): the first
        // sample after it becomes the ambient level instead of leaving the detector blind.
        this.ambientDb = this.calibratedAmbient() ?? level;
      }
      if (level > this.ambientDb + this.config.thresholdDb) {
        if (this.aboveSinceMs === null) this.aboveSinceMs = elapsed;
        if (elapsed - this.aboveSinceMs >= this.config.minDurationMs) {
          return this.finish('answer', elapsed);
        }
      } else {
        this.aboveSinceMs = null;
      }
    }

    if (elapsed >= this.config.windowMs) return this.finish('silence', null);
    return null;
  }

  // Call when the window timer fires and no sample has decided yet.
  expire(): DetectorResult {
    return this.result ?? this.finish('silence', null);
  }

  private calibratedAmbient(): number | null {
    const samples = this.calibrationSamples;
    if (samples.length > 0) {
      const sorted = [...samples].sort((x, y) => x - y);
      return sorted[Math.floor(0.1 * (sorted.length - 1))];
    }
    return this.calibrationSeen > 0 ? LEVEL_FLOOR_DB : null;
  }

  private finish(outcome: DetectorResult['outcome'], detectedAtMs: number | null): DetectorResult {
    if (this.ambientDb === null) this.ambientDb = this.calibratedAmbient();
    this.result = {
      outcome,
      ambientDb: this.ambientDb,
      peakDb: this.peakDb,
      detectedAtMs,
      samples: this.samples,
    };
    return this.result;
  }
}

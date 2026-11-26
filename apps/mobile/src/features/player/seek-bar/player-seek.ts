// Pure helpers of the time bar (SeekBar.tsx). No React Native here, so they are tested.

// How far the increment and decrement actions of a screen reader move the position.
export const SEEK_STEP_SEC = 10;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// The library slider runs on whole steps from 0 to SLIDER_STEPS (min 0, max SLIDER_STEPS, step 1).
// On Android the native bar is integer-valued, and without a step it would use only 128 steps
// (a 10-minute story would move in 4.7 s jumps); 1000 steps is under 2 s even for a 30-minute story.
export const SLIDER_STEPS = 1000;

// The slider value (0 to SLIDER_STEPS) that stands for a share of the story, 0 to 1.
export function sliderValueAtFraction(fraction: number): number {
  return Math.round(clamp01(fraction) * SLIDER_STEPS);
}

// The share of the story, 0 to 1, that a slider value stands for.
export function fractionAtSliderValue(value: number): number {
  return clamp01(value / SLIDER_STEPS);
}

// The new position, in seconds, after an increment (+) or decrement (-) action. The result is a
// fraction so that it goes through the same path as a drag (secondsAtFraction in the caller, and
// the engine clamps it to the story).
export function fractionAfterStep(fraction: number, stepSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return clamp01(fraction + stepSec / durationSec);
}

// The thumb size (design: 12 px at rest). The native slider cannot grow it while held.
export const THUMB_SIZE = 12;

import { secondsAtFraction } from './player-stories';
import {
  fractionAfterStep,
  fractionAtSliderValue,
  SEEK_STEP_SEC,
  SLIDER_STEPS,
  sliderValueAtFraction,
} from './player-seek';

describe('slider values', () => {
  it('maps a share of the story to a whole step and back', () => {
    expect(sliderValueAtFraction(0)).toBe(0);
    expect(sliderValueAtFraction(0.25)).toBe(250);
    expect(sliderValueAtFraction(1)).toBe(SLIDER_STEPS);
    expect(fractionAtSliderValue(250)).toBe(0.25);
    expect(fractionAtSliderValue(SLIDER_STEPS)).toBe(1);
  });

  it('stays inside the story for out-of-range and broken input', () => {
    expect(sliderValueAtFraction(-1)).toBe(0);
    expect(sliderValueAtFraction(7)).toBe(SLIDER_STEPS);
    expect(sliderValueAtFraction(Number.NaN)).toBe(0);
    expect(fractionAtSliderValue(-5)).toBe(0);
    expect(fractionAtSliderValue(SLIDER_STEPS * 2)).toBe(1);
    expect(fractionAtSliderValue(Number.NaN)).toBe(0);
  });

  it('turns the value dropped by a finger into seconds of the story', () => {
    expect(secondsAtFraction(fractionAtSliderValue(500), 600)).toBe(300);
  });
});

describe('fractionAfterStep', () => {
  it('moves by whole seconds of the story', () => {
    const fraction = fractionAfterStep(0.5, SEEK_STEP_SEC, 200);
    expect(secondsAtFraction(fraction, 200)).toBeCloseTo(110);
    expect(secondsAtFraction(fractionAfterStep(0.5, -SEEK_STEP_SEC, 200), 200)).toBeCloseTo(90);
  });

  it('stops at the ends and ignores a story without length', () => {
    expect(fractionAfterStep(0.99, SEEK_STEP_SEC, 200)).toBe(1);
    expect(fractionAfterStep(0.01, -SEEK_STEP_SEC, 200)).toBe(0);
    expect(fractionAfterStep(0.5, SEEK_STEP_SEC, 0)).toBe(0);
  });
});

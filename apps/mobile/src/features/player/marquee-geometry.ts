// The running title of the player (design 3a, `Marquee`): a title that does not fit on one line
// stands still for a moment, slides to the left, and its own beginning follows it round the
// circle. The numbers are the design's.

// Gap between the end of the text and its second copy, px.
export const MARQUEE_GAP = 48;
// Speed of the slide, px per second.
export const MARQUEE_SPEED = 32;
// The title stands still this long before each slide, ms.
export const MARQUEE_HOLD_MS = 2500;

export type MarqueeGeometry = {
  // False when the title fits (or has not been measured yet): it then stands still.
  scrolls: boolean;
  // How far one round moves the track to the left: the text and the gap.
  distance: number;
  // How long that move takes, ms (without the hold).
  moveMs: number;
};

// `textWidth` is the width of the whole title on one line, `boxWidth` the width it may use. One
// pixel of slack so that a title that fits exactly does not start running on a rounding error.
export function marqueeGeometry(textWidth: number, boxWidth: number): MarqueeGeometry {
  const measured = textWidth > 0 && boxWidth > 0;
  if (!measured || textWidth <= boxWidth + 1) return { scrolls: false, distance: 0, moveMs: 0 };
  const distance = textWidth + MARQUEE_GAP;
  return { scrolls: true, distance, moveMs: Math.round((distance / MARQUEE_SPEED) * 1000) };
}

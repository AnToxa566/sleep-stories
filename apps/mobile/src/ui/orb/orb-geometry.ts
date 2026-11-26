// Pure geometry and colour maths for the Orb. React Native has no conic gradient, so a
// conic gradient is drawn as many thin pie wedges whose colours are interpolated along the
// turn. Kept free of React so it is unit-tested without a device.

export type Rgba = readonly [number, number, number, number];
// `at` is the position along one full turn, 0 (top) to 1, clockwise, like CSS conic-gradient.
export type ConicStop = { at: number; color: Rgba };
export type Wedge = { d: string; fill: string };

export function hexToRgba(hex: string, alpha = 1): Rgba {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error('Expected a #RRGGBB colour');
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

export function toRgbaString([r, g, b, a]: Rgba): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(a.toFixed(3))})`;
}

// Linear interpolation between the two neighbouring stops; before the first and after the
// last stop the end colours hold, as in CSS.
export function colorAt(stops: readonly ConicStop[], t: number): Rgba {
  if (stops.length === 0) throw new Error('At least one stop is required');
  if (t <= stops[0].at) return stops[0].color;
  const last = stops[stops.length - 1];
  if (t >= last.at) return last.color;
  for (let i = 1; i < stops.length; i++) {
    const to = stops[i];
    if (t <= to.at) {
      const from = stops[i - 1];
      const span = to.at - from.at;
      const k = span === 0 ? 1 : (t - from.at) / span;
      return [
        from.color[0] + (to.color[0] - from.color[0]) * k,
        from.color[1] + (to.color[1] - from.color[1]) * k,
        from.color[2] + (to.color[2] - from.color[2]) * k,
        from.color[3] + (to.color[3] - from.color[3]) * k,
      ];
    }
  }
  return last.color;
}

// `count` wedges around a circle of `radius` centred at (cx, cy). Angles run clockwise from
// the top. `startDeg` turns the whole gradient (CSS `from 90deg`). `overlapDeg` widens each
// wedge a little so antialiasing leaves no hairline seams in an opaque ring; leave it at 0 for
// translucent layers, where an overlap would show as brighter lines.
export function conicWedges(options: {
  stops: readonly ConicStop[];
  count: number;
  cx: number;
  cy: number;
  radius: number;
  startDeg?: number;
  overlapDeg?: number;
}): Wedge[] {
  const { stops, count, cx, cy, radius, startDeg = 0, overlapDeg = 0 } = options;
  const step = 360 / count;
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(cx + radius * Math.sin(rad)).toFixed(2)} ${(cy - radius * Math.cos(rad)).toFixed(2)}`;
  };
  const wedges: Wedge[] = [];
  for (let i = 0; i < count; i++) {
    const from = i * step;
    const to = from + step + overlapDeg;
    const mid = from + step / 2;
    const turn = (((mid - startDeg) / 360) % 1 + 1) % 1;
    wedges.push({
      d: `M ${cx} ${cy} L ${point(from)} A ${radius} ${radius} 0 0 1 ${point(to)} Z`,
      fill: toRgbaString(colorAt(stops, turn)),
    });
  }
  return wedges;
}

// Sizes and offsets of the Orb layers, from the design (glow inset -20%, sheen inset 3%, dark
// disc inset 11%). The disc never changes size; only the coloured layers breathe.
export function orbLayout(size: number) {
  return {
    glowSize: size * 1.4,
    glowOffset: -size * 0.2,
    sheenSize: size * 0.94,
    sheenOffset: size * 0.03,
    discRadius: size * 0.39,
  };
}

// Opacity of the whole coloured part (glow, ring, sheen): 3a full, 3b dimmed, 3d gone.
// `asleep` wins over `dim`.
export const ORB_DIM_OPACITY = 0.18;
export function colourOpacity(state: { dim?: boolean; asleep?: boolean }): number {
  if (state.asleep) return 0;
  return state.dim ? ORB_DIM_OPACITY : 1;
}

// How the coloured layers breathe and shimmer. The scale is applied to the coloured group
// only (never the disc); the glow's own opacity drifts between the two values, so the colour
// seems to shimmer. Periods differ so the layers do not move in step.
export const ORB_BREATH = {
  scaleMax: 1.07,
  breatheMs: 7_000,
  glowOpacity: { min: 0.28, max: 0.5 },
  glowShimmerMs: 5_000,
  sheenOpacity: { min: 0.55, max: 1 },
  sheenShimmerMs: 3_500,
} as const;

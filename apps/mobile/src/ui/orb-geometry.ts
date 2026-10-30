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

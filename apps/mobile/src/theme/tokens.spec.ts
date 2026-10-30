import { colors } from './tokens';

type Rgb = readonly [number, number, number];

function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  throw new Error(`Unparsable colour: ${value}`);
}

describe('colour tokens', () => {
  it.each(Object.entries(colors))('%s is not white and is parsable', (_name, value) => {
    const [r, g, b] = parseColor(value);
    expect([r, g, b]).not.toEqual([255, 255, 255]);
  });

  it('keeps the brightest text colour tinted, not neutral white', () => {
    // #F1ECFF has a full blue channel but a lower red and green: a lavender tint.
    const [r, g] = parseColor(colors.text);
    expect(Math.min(r, g)).toBeLessThan(250);
  });

  it('uses the dark base colour from the designs', () => {
    expect(colors.base).toBe('#09070F');
    expect(colors.text).toBe('#F1ECFF');
    expect(colors.muted).toBe('#A9A1D2');
  });
});

import { colorAt, conicWedges, hexToRgba, toRgbaString, type ConicStop } from './orb-geometry';

const redToBlue: ConicStop[] = [
  { at: 0, color: hexToRgba('#FF0000') },
  { at: 1, color: hexToRgba('#0000FF') },
];

describe('hexToRgba and toRgbaString', () => {
  it('parses a hex colour with an alpha', () => {
    expect(hexToRgba('#8F7CFF', 0.5)).toEqual([143, 124, 255, 0.5]);
    expect(toRgbaString(hexToRgba('#8F7CFF', 0.5))).toBe('rgba(143,124,255,0.5)');
  });

  it('refuses anything but #RRGGBB', () => {
    expect(() => hexToRgba('#fff')).toThrow();
    expect(() => hexToRgba('red')).toThrow();
  });
});

describe('colorAt', () => {
  it('returns the end colours at and beyond the ends', () => {
    expect(colorAt(redToBlue, 0)).toEqual([255, 0, 0, 1]);
    expect(colorAt(redToBlue, 1)).toEqual([0, 0, 255, 1]);
    expect(colorAt(redToBlue, 2)).toEqual([0, 0, 255, 1]);
  });

  it('interpolates linearly, alpha included', () => {
    const faded: ConicStop[] = [
      { at: 0, color: [10, 20, 30, 0] },
      { at: 0.5, color: [110, 120, 130, 1] },
    ];
    expect(colorAt(faded, 0.25)).toEqual([60, 70, 80, 0.5]);
    expect(colorAt(faded, 0.9)).toEqual([110, 120, 130, 1]);
  });
});

describe('conicWedges', () => {
  it('makes `count` wedges that start at the top and walk clockwise', () => {
    const wedges = conicWedges({ stops: redToBlue, count: 4, cx: 50, cy: 50, radius: 40 });
    expect(wedges).toHaveLength(4);
    // First wedge: from the top (50, 10) to the right (90, 50).
    expect(wedges[0].d).toBe('M 50 50 L 50.00 10.00 A 40 40 0 0 1 90.00 50.00 Z');
    // Last wedge ends where the first started: the top.
    expect(wedges[3].d.endsWith('50.00 10.00 Z')).toBe(true);
  });

  it('colours each wedge by its middle angle', () => {
    const wedges = conicWedges({ stops: redToBlue, count: 2, cx: 0, cy: 0, radius: 1 });
    expect(wedges[0].fill).toBe('rgba(191,0,64,1)');
    expect(wedges[1].fill).toBe('rgba(64,0,191,1)');
  });

  it('turns the gradient with startDeg', () => {
    const plain = conicWedges({ stops: redToBlue, count: 4, cx: 0, cy: 0, radius: 1 });
    const turned = conicWedges({ stops: redToBlue, count: 4, cx: 0, cy: 0, radius: 1, startDeg: 90 });
    // The wedge that is first when turned by 90 degrees is the one at 90..180 when not.
    expect(turned[1].fill).toBe(plain[0].fill);
  });

  it('widens wedges by overlapDeg so an opaque ring has no seams', () => {
    const wedges = conicWedges({ stops: redToBlue, count: 4, cx: 50, cy: 50, radius: 40, overlapDeg: 1 });
    expect(wedges[0].d).not.toBe('M 50 50 L 50.00 10.00 A 40 40 0 0 1 90.00 50.00 Z');
  });
});

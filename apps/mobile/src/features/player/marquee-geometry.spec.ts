import { MARQUEE_GAP, marqueeGeometry } from './marquee-geometry';

describe('marqueeGeometry', () => {
  it('does not run when the title fits', () => {
    expect(marqueeGeometry(200, 320).scrolls).toBe(false);
    expect(marqueeGeometry(320, 320).scrolls).toBe(false);
  });

  it('does not run on a rounding error of one pixel', () => {
    expect(marqueeGeometry(321, 320).scrolls).toBe(false);
    expect(marqueeGeometry(321.5, 320).scrolls).toBe(true);
  });

  it('does not run before the widths are measured', () => {
    expect(marqueeGeometry(0, 320).scrolls).toBe(false);
    expect(marqueeGeometry(500, 0).scrolls).toBe(false);
  });

  it('moves by the text and the gap, at 32 px per second', () => {
    const geometry = marqueeGeometry(432, 320);
    expect(geometry.distance).toBe(432 + MARQUEE_GAP);
    expect(geometry.moveMs).toBe(15000);
  });
});

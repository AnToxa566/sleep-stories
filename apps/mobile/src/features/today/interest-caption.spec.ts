import type { Interest } from '@sleep-stories/contracts';
import { captionInterests } from './interest-caption';

const catalogue: Interest[] = [
  { slug: 'history', title: 'История' },
  { slug: 'space', title: 'Космос' },
  { slug: 'nature', title: 'Природа' },
  { slug: 'myths', title: 'Мифы' },
];

describe('captionInterests', () => {
  it('names the selected interests first, lowercased, then the typed ones', () => {
    expect(
      captionInterests({ interestSlugs: ['space', 'history'], customInterests: ['морские звёзды'] }, catalogue),
    ).toEqual(['космос', 'история', 'морские звёзды']);
  });

  it('keeps at most three', () => {
    expect(
      captionInterests(
        { interestSlugs: ['history', 'space', 'nature', 'myths'], customInterests: ['x'] },
        catalogue,
      ),
    ).toEqual(['история', 'космос', 'природа']);
    expect(
      captionInterests({ interestSlugs: ['history'], customInterests: ['a', 'b', 'c'] }, catalogue),
    ).toEqual(['история', 'a', 'b']);
  });

  it('skips a slug that is not in the catalogue and returns an empty list for nothing', () => {
    expect(captionInterests({ interestSlugs: ['gone'], customInterests: [] }, catalogue)).toEqual([]);
    expect(captionInterests({ interestSlugs: [], customInterests: [] }, [])).toEqual([]);
  });
});

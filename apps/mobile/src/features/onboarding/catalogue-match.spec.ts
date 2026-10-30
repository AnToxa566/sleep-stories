import { resolveInterestEntry } from './catalogue-match';

const catalogue = [
  { slug: 'sea', title: 'Море' },
  { slug: 'forest', title: 'Лес' },
];

describe('resolveInterestEntry', () => {
  it('matches a catalogue title in a different case', () => {
    expect(resolveInterestEntry('мОРЕ', catalogue, [])).toEqual({
      kind: 'catalogue',
      slug: 'sea',
      alreadySelected: false,
    });
  });

  it('returns custom when nothing matches', () => {
    expect(resolveInterestEntry('маяки', catalogue, [])).toEqual({ kind: 'custom' });
  });

  it('reports an already selected match', () => {
    expect(resolveInterestEntry('лес', catalogue, ['forest'])).toEqual({
      kind: 'catalogue',
      slug: 'forest',
      alreadySelected: true,
    });
  });

  it('ignores surrounding whitespace', () => {
    expect(resolveInterestEntry('   Море  ', catalogue, [])).toMatchObject({
      kind: 'catalogue',
      slug: 'sea',
    });
  });

  it('does not match a partial title', () => {
    expect(resolveInterestEntry('мор', catalogue, [])).toEqual({ kind: 'custom' });
  });

  it('matches decomposed text against a composed title', () => {
    const withBreve = [{ slug: 'tea', title: 'Чай' }];
    expect(resolveInterestEntry('чай', withBreve, [])).toMatchObject({ slug: 'tea' });
  });

  it('returns custom for blank text and an empty catalogue', () => {
    expect(resolveInterestEntry('   ', catalogue, [])).toEqual({ kind: 'custom' });
    expect(resolveInterestEntry('море', [], [])).toEqual({ kind: 'custom' });
  });
});

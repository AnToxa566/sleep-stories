import { narratorSelection } from './narrator-selection';

const voices = [{ slug: 'anna' }, { slug: 'lev' }];

describe('narratorSelection', () => {
  it('selects the saved voice and has nothing to save before a tap', () => {
    expect(narratorSelection({ saved: 'anna', picked: null, voices })).toEqual({
      selected: 'anna',
      toSave: null,
    });
  });

  it('can save another voice from the list', () => {
    expect(narratorSelection({ saved: 'anna', picked: 'lev', voices })).toEqual({
      selected: 'lev',
      toSave: 'lev',
    });
  });

  it('has nothing to save once the saved voice is picked again', () => {
    expect(narratorSelection({ saved: 'anna', picked: 'anna', voices })).toEqual({
      selected: 'anna',
      toSave: null,
    });
  });

  it('cannot save a pick that is not in the list, or before the list is loaded', () => {
    expect(narratorSelection({ saved: 'anna', picked: 'gone', voices }).toSave).toBeNull();
    expect(narratorSelection({ saved: 'anna', picked: 'lev', voices: undefined }).toSave).toBeNull();
  });

  it('cannot save while the saved voice is unknown', () => {
    expect(narratorSelection({ saved: null, picked: 'lev', voices }).toSave).toBeNull();
  });

  it('selects no row when the saved voice left the list, and lets another be saved', () => {
    const before = narratorSelection({ saved: 'gone', picked: null, voices });
    expect(voices.some((voice) => voice.slug === before.selected)).toBe(false);
    expect(before.toSave).toBeNull();
    expect(narratorSelection({ saved: 'gone', picked: 'lev', voices }).toSave).toBe('lev');
  });
});

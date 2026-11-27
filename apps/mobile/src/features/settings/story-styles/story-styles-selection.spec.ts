import { ChangeStylesRequestSchema, type StoryStyle } from '@sleep-stories/contracts';
import { stylesToSave, toggleStyle } from './story-styles-selection';

describe('toggleStyle', () => {
  it('ticks a style that is off and unticks one that is on', () => {
    expect(toggleStyle(['facts'], 'history')).toEqual(['facts', 'history']);
    expect(toggleStyle(['facts', 'history'], 'facts')).toEqual(['history']);
  });

  it('may untick the last style', () => {
    expect(toggleStyle(['facts'], 'facts')).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const selected: readonly StoryStyle[] = Object.freeze<StoryStyle[]>(['facts']);
    toggleStyle(selected, 'history');
    toggleStyle(selected, 'facts');
    expect(selected).toEqual(['facts']);
  });
});

describe('stylesToSave', () => {
  const saved: readonly StoryStyle[] = ['facts', 'history'];

  it('is null while there are no preferences, even with a draft', () => {
    expect(stylesToSave({ saved: null, draft: ['facts'] })).toBeNull();
    expect(stylesToSave({ saved: null, draft: null })).toBeNull();
  });

  it('is null before the first tap', () => {
    expect(stylesToSave({ saved, draft: null })).toBeNull();
  });

  it('is null for the saved set in any order', () => {
    expect(stylesToSave({ saved, draft: ['facts', 'history'] })).toBeNull();
    expect(stylesToSave({ saved, draft: ['history', 'facts'] })).toBeNull();
  });

  it('is null again after a style is ticked off and back on', () => {
    const draft = toggleStyle(toggleStyle(saved, 'facts'), 'facts');
    expect(stylesToSave({ saved, draft })).toBeNull();
  });

  it('is null with no style ticked', () => {
    expect(stylesToSave({ saved, draft: [] })).toBeNull();
  });

  it('is null for a draft the contract refuses', () => {
    expect(stylesToSave({ saved, draft: ['facts', 'facts'] })).toBeNull();
  });

  it('sends the changed set in the order of the rows', () => {
    const request = stylesToSave({ saved, draft: ['history', 'fairy_tale', 'facts'] });
    expect(request).toEqual({ styles: ['facts', 'fairy_tale', 'history'] });
    expect(ChangeStylesRequestSchema.safeParse(request).success).toBe(true);
  });

  it('sends a smaller set and a set of the same size', () => {
    expect(stylesToSave({ saved, draft: ['history'] })).toEqual({ styles: ['history'] });
    expect(stylesToSave({ saved, draft: ['history', 'fairy_tale'] })).toEqual({
      styles: ['fairy_tale', 'history'],
    });
  });
});

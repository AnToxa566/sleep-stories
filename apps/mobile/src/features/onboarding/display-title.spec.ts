import { displayCustomTitle } from './display-title';

describe('displayCustomTitle', () => {
  it('capitalises the first letter only', () => {
    expect(displayCustomTitle('морские путешествия')).toBe('Морские путешествия');
  });

  it('leaves an already capitalised or non-letter start alone', () => {
    expect(displayCustomTitle('Космос')).toBe('Космос');
    expect(displayCustomTitle('3d-печать')).toBe('3d-печать');
  });

  it('handles an empty string and a leading emoji', () => {
    expect(displayCustomTitle('')).toBe('');
    expect(displayCustomTitle('🌙 сны')).toBe('🌙 сны');
  });
});

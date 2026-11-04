import { fontFamilies, fontFamilyForWeight } from './fonts';

describe('fontFamilyForWeight', () => {
  it('maps the weights the designs use', () => {
    expect(fontFamilyForWeight('200')).toBe(fontFamilies.extraLight);
    expect(fontFamilyForWeight('300')).toBe(fontFamilies.light);
    expect(fontFamilyForWeight('400')).toBe(fontFamilies.regular);
    expect(fontFamilyForWeight('500')).toBe(fontFamilies.medium);
  });

  it('treats a missing weight and "normal" as regular', () => {
    expect(fontFamilyForWeight(undefined)).toBe(fontFamilies.regular);
    expect(fontFamilyForWeight(null)).toBe(fontFamilies.regular);
    expect(fontFamilyForWeight('normal')).toBe(fontFamilies.regular);
    expect(fontFamilyForWeight('garbage')).toBe(fontFamilies.regular);
  });

  it('takes the nearest bundled weight for the others', () => {
    expect(fontFamilyForWeight('100')).toBe(fontFamilies.extraLight);
    expect(fontFamilyForWeight(300)).toBe(fontFamilies.light);
    expect(fontFamilyForWeight('600')).toBe(fontFamilies.medium);
    expect(fontFamilyForWeight('bold')).toBe(fontFamilies.medium);
    expect(fontFamilyForWeight('900')).toBe(fontFamilies.medium);
  });
});

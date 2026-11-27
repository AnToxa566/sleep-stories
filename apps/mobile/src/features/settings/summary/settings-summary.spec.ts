import type { Preferences, Voice } from '@sleep-stories/contracts';
import { settingsSummary } from './settings-summary';

const preferences: Preferences = {
  voiceSlug: 'anna',
  styles: ['facts', 'fairy_tale', 'history'],
  interestSlugs: ['space', 'sea'],
  customInterests: ['маяки'],
};

const voice = (slug: string, name: string): Voice => ({
  slug,
  name,
  description: 'спокойный голос',
  sampleUrl: 'https://example.com/sample.mp3',
});

const voices = [voice('maxim', 'Максим'), voice('anna', 'Анна')];

const all = {
  preferences,
  voices,
  email: 'someone@example.com',
  generations: { left: 3, limit: 5 },
};

describe('settingsSummary', () => {
  it('words every value when everything is loaded', () => {
    expect(settingsSummary(all)).toEqual({
      voiceName: 'Анна',
      interests: '3',
      styles: 'Факты, Сказка, История',
      email: 'someone@example.com',
      generations: '3 из 5',
    });
  });

  it('shows a dash for the preference values without preferences', () => {
    expect(settingsSummary({ ...all, preferences: null })).toMatchObject({
      voiceName: '—',
      interests: '—',
      styles: '—',
      email: 'someone@example.com',
      generations: '3 из 5',
    });
  });

  it('shows a dash for the narrator while the voices are not loaded', () => {
    expect(settingsSummary({ ...all, voices: undefined }).voiceName).toBe('—');
  });

  it('shows a dash for a voice that is not in the catalogue', () => {
    const unknown = { ...preferences, voiceSlug: 'nobody' };
    expect(settingsSummary({ ...all, preferences: unknown }).voiceName).toBe('—');
  });

  it('counts typed interests alone, without showing their text', () => {
    const typed = { ...preferences, interestSlugs: [], customInterests: ['маяки', 'поезда'] };
    const summary = settingsSummary({ ...all, preferences: typed });
    expect(summary.interests).toBe('2');
    expect(Object.values(summary).join(' ')).not.toContain('маяки');
  });

  it('words one style without a separator', () => {
    const one: Preferences = { ...preferences, styles: ['history'] };
    expect(settingsSummary({ ...all, preferences: one }).styles).toBe('История');
  });

  it('shows a dash without an email', () => {
    expect(settingsSummary({ ...all, email: null }).email).toBe('—');
  });

  it('shows a dash while the allowance is missing', () => {
    expect(settingsSummary({ ...all, generations: undefined }).generations).toBe('—');
  });

  it('shows zero left as a number, not as a dash', () => {
    expect(settingsSummary({ ...all, generations: { left: 0, limit: 5 } }).generations).toBe(
      '0 из 5',
    );
  });

  it('takes the limit from the server', () => {
    expect(settingsSummary({ ...all, generations: { left: 7, limit: 12 } }).generations).toBe(
      '7 из 12',
    );
  });
});

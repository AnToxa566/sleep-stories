import {
  PLACEHOLDER_VOICE_SLUGS,
  StoryStyleSchema,
} from '@sleep-stories/contracts';
import { strings, styleCopy, voiceCopy } from './strings';

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

const allCopy = [
  ...collectStrings(strings),
  ...collectStrings(voiceCopy),
  ...collectStrings(styleCopy),
];

describe('strings', () => {
  it('has copy for every placeholder voice slug', () => {
    for (const slug of PLACEHOLDER_VOICE_SLUGS) {
      expect(voiceCopy[slug].name.length).toBeGreaterThan(0);
      expect(voiceCopy[slug].description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(voiceCopy).sort()).toEqual([...PLACEHOLDER_VOICE_SLUGS].sort());
  });

  it('has a label and a description for every story style', () => {
    expect(Object.keys(styleCopy).sort()).toEqual([...StoryStyleSchema.options].sort());
    for (const style of StoryStyleSchema.options) {
      expect(styleCopy[style].label.length).toBeGreaterThan(0);
      expect(styleCopy[style].description.length).toBeGreaterThan(0);
    }
  });

  it('never mentions the microphone or screen-free control', () => {
    const joined = allCopy.join('\n').toLowerCase();
    expect(joined).not.toContain('микрофон');
    expect(joined).not.toContain('без касаний');
  });

  it('contains no secret-looking or technical text', () => {
    for (const text of allCopy) {
      expect(text).not.toMatch(/sb_(secret|publishable)_|eyJ|service_role|https?:\/\//);
      expect(text.trim()).toBe(text);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('keeps the Russian copy the owner decided', () => {
    expect(strings.home.title).toBe('Главный экран');
    expect(strings.home.signOut).toBe('Выйти');
    expect(strings.onboarding.permissions.title).toBe('Разрешения');
    expect(strings.gate.errorBody.length).toBeGreaterThan(0);
    expect(strings.common.retry).toBe('Повторить');
  });

  it('writes the step counter in Russian', () => {
    expect(strings.onboarding.stepOf(2, 3)).toBe('Шаг 2 из 3');
  });
});

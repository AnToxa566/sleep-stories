import type { Preferences, QueueResponse, Voice } from '@sleep-stories/contracts';
import { strings, styleCopy } from '../../../strings';

type Input = {
  preferences: Preferences | null;
  voices: readonly Voice[] | undefined;
  email: string | null;
  generations: QueueResponse['generations'] | undefined;
};

export type SettingsSummary = {
  voiceName: string;
  interests: string;
  styles: string;
  email: string;
  generations: string;
};

// The values of the rows on «Настройки». A value that is still loading or failed to load is a
// dash. Typed interests are only counted: their text is not shown on this screen.
export function settingsSummary({
  preferences,
  voices,
  email,
  generations,
}: Input): SettingsSummary {
  const { unknown, allowance } = strings.settings;
  const voice = preferences
    ? voices?.find((candidate) => candidate.slug === preferences.voiceSlug)
    : undefined;
  return {
    voiceName: voice?.name ?? unknown,
    interests: preferences
      ? String(preferences.interestSlugs.length + preferences.customInterests.length)
      : unknown,
    // The server sends the styles in their canonical order.
    styles: preferences
      ? preferences.styles.map((style) => styleCopy[style].label).join(', ')
      : unknown,
    email: email ?? unknown,
    // Both numbers come from the server, so the limit is not written into the app.
    generations: generations ? allowance(generations.left, generations.limit) : unknown,
  };
}

// Onest, the font of the designs (ARCHITECTURE.md section 7, "Fonts"). The files are bundled
// into the app (`@expo-google-fonts/onest`, loaded in `load-fonts.ts`), nothing is fetched at
// run time. Only the four weights the designs use are bundled (about 380 KB in all).
//
// Why a family per weight: React Native on Android does not pick a font file by `fontWeight`
// for a custom font, so each weight is its own family name and `fontWeight` is translated by
// `fontFamilyForWeight` (used by `ui/typography.tsx`, which every screen uses instead of the
// raw `Text` and `TextInput`).

export const fontFamilies = {
  extraLight: 'Onest_200ExtraLight',
  light: 'Onest_300Light',
  regular: 'Onest_400Regular',
  medium: 'Onest_500Medium',
} as const;

// A weight we did not bundle takes the nearest one we did: 100 -> 200, 600 and above -> 500.
// The designs use no bold, so a stray `bold` stays medium instead of being faked by the system.
export function fontFamilyForWeight(weight: string | number | undefined | null): string {
  if (weight === undefined || weight === null || weight === 'normal') return fontFamilies.regular;
  if (weight === 'bold') return fontFamilies.medium;
  const value = typeof weight === 'number' ? weight : Number.parseInt(weight, 10);
  if (!Number.isFinite(value)) return fontFamilies.regular;
  if (value <= 250) return fontFamilies.extraLight;
  if (value <= 350) return fontFamilies.light;
  if (value <= 450) return fontFamilies.regular;
  return fontFamilies.medium;
}

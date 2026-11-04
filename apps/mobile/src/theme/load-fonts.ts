import { useFonts } from 'expo-font';
// One import per weight on purpose: the package root requires all nine weights, and Metro
// would bundle every file. These paths bundle only the four the designs use.
import { Onest_200ExtraLight } from '@expo-google-fonts/onest/200ExtraLight';
import { Onest_300Light } from '@expo-google-fonts/onest/300Light';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { fontFamilies } from './fonts';

// Kept out of `fonts.ts` so unit tests (which cannot load .ttf files) never import the assets.
// `true` once the fonts are ready, or once loading failed: a missing font must not keep the
// person on the splash screen, the system font is the fallback.
export function useOnestFonts(): boolean {
  const [loaded, error] = useFonts({
    [fontFamilies.extraLight]: Onest_200ExtraLight,
    [fontFamilies.light]: Onest_300Light,
    [fontFamilies.regular]: Onest_400Regular,
    [fontFamilies.medium]: Onest_500Medium,
  });
  return loaded || error !== null;
}

import {
  CompleteOnboardingRequestSchema,
  CUSTOM_INTERESTS_MAX_COUNT,
  CustomInterestSchema,
  type CompleteOnboardingRequest,
  type StoryStyle,
} from '@sleep-stories/contracts';
import { create } from 'zustand';

// The answers of the three-step onboarding, in memory until the final "Готово", which
// sends them in one request. Nothing is preselected. A pure module (no React Native), so it
// is unit-tested; Logout clears it through registerSignOutCleanup in the root layout.
type OnboardingData = {
  voiceSlug: string | null;
  styles: StoryStyle[];
  interestSlugs: string[];
  // Free-text topics, kept already normalised (trimmed, lowercased). Untrusted text: never logged.
  customInterests: string[];
};

type OnboardingState = OnboardingData & {
  selectVoice: (slug: string) => void;
  toggleStyle: (style: StoryStyle) => void;
  toggleInterest: (slug: string) => void;
  // Returns true when the text was added; false for blank or invalid text, a duplicate
  // (case-insensitive) or when the cap is reached.
  addCustomInterest: (text: string) => boolean;
  removeCustomInterest: (text: string) => void;
  reset: () => void;
  // The request for PUT /me/onboarding, or null while the answers do not pass the contract.
  buildRequest: () => CompleteOnboardingRequest | null;
};

const EMPTY: OnboardingData = {
  voiceSlug: null,
  styles: [],
  interestSlugs: [],
  customInterests: [],
};

function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...EMPTY,
  selectVoice: (slug) => set({ voiceSlug: slug }),
  toggleStyle: (style) => set((state) => ({ styles: toggled(state.styles, style) })),
  toggleInterest: (slug) => set((state) => ({ interestSlugs: toggled(state.interestSlugs, slug) })),
  addCustomInterest: (text) => {
    const parsed = CustomInterestSchema.safeParse(text);
    if (!parsed.success) return false;
    const { customInterests } = get();
    if (
      customInterests.length >= CUSTOM_INTERESTS_MAX_COUNT ||
      customInterests.includes(parsed.data)
    ) {
      return false;
    }
    set({ customInterests: [...customInterests, parsed.data] });
    return true;
  },
  removeCustomInterest: (text) =>
    set((state) => ({
      customInterests: state.customInterests.filter((entry) => entry !== text),
    })),
  reset: () => set({ ...EMPTY }),
  buildRequest: () => {
    const { voiceSlug, styles, interestSlugs, customInterests } = get();
    const parsed = CompleteOnboardingRequestSchema.safeParse({
      voiceSlug,
      styles,
      interestSlugs,
      customInterests,
    });
    return parsed.success ? parsed.data : null;
  },
}));

// "Is this step valid": "Дальше" is disabled until it is. Step 3 has no answers of its own.
export const isVoiceStepValid = (state: OnboardingData): boolean => state.voiceSlug !== null;
export const isInterestsStepValid = (state: OnboardingData): boolean =>
  state.interestSlugs.length + state.customInterests.length > 0 && state.styles.length > 0;

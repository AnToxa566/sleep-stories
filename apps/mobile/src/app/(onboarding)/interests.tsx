import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography/typography';
import { useInterests } from '../../api/catalogue/use-interests';
import { OnboardingHeader } from '../../features/onboarding/steps/OnboardingHeader';
import {
  isInterestsStepValid,
  useOnboardingStore,
} from '../../features/onboarding/onboarding-store';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { resolveInterestEntry } from '../../ui/interests/catalogue-match';
import { InterestPicker } from '../../ui/interests/InterestPicker';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { Screen } from '../../ui/layout/Screen';
import { StyleList } from '../../ui/story-styles/StyleList';
import { StepHeading } from '../../features/onboarding/steps/StepHeading';

// Step 2 of 3: interest chips (from GET /interests), own topics and story styles. "Дальше"
// needs at least one interest (catalogue or own) and one style.
// Going back keeps the selections: they live in the onboarding store, not in this screen.
export default function InterestsStep() {
  const router = useRouter();
  const interestSlugs = useOnboardingStore((state) => state.interestSlugs);
  const selectedStyles = useOnboardingStore((state) => state.styles);
  const toggleInterest = useOnboardingStore((state) => state.toggleInterest);
  const customInterests = useOnboardingStore((state) => state.customInterests);
  const toggleStyle = useOnboardingStore((state) => state.toggleStyle);
  const addCustomInterest = useOnboardingStore((state) => state.addCustomInterest);
  const removeCustomInterest = useOnboardingStore((state) => state.removeCustomInterest);
  const valid = useOnboardingStore(isInterestsStepValid);
  const interests = useInterests();

  // A topic equal to a catalogue title selects that chip instead (the API would refuse it as
  // a custom topic). Otherwise the store normalises, drops blanks, duplicates and anything
  // over the cap; false (nothing was added) keeps the text in the field.
  const addCustom = (text: string): boolean => {
    const entry = resolveInterestEntry(text, interests.data?.interests ?? [], interestSlugs);
    if (entry.kind === 'catalogue') {
      if (!entry.alreadySelected) toggleInterest(entry.slug);
      return true;
    }
    return addCustomInterest(text);
  };

  return (
    <Screen scroll header={<OnboardingHeader step={2} onBack={() => router.back()} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(2, 3)}
        title={strings.onboarding.interests.title}
        subtitle={strings.onboarding.interests.subtitle}
      />
      <InterestPicker
        catalogue={interests.data?.interests}
        loadFailed={interests.isError}
        onRetry={() => void interests.refetch()}
        selectedSlugs={interestSlugs}
        onToggleSlug={toggleInterest}
        customChips={customInterests.map((text) => ({ text, selected: true }))}
        onPressCustom={removeCustomInterest}
        customHint={strings.onboarding.interests.removeCustomLabel}
        onSubmitText={addCustom}
      />

      <Text style={styles.sectionLabel}>{strings.onboarding.interests.stylesHeading}</Text>
      <View style={styles.styleList}>
        <StyleList selected={selectedStyles} onToggle={toggleStyle} />
      </View>

      <View style={styles.bottom}>
        <PrimaryButton
          label={strings.common.next}
          disabled={!valid}
          onPress={() => router.push('/permissions')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: spacing.xxl - 4,
  },
  styleList: { marginTop: 6 },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});

import { PLACEHOLDER_INTEREST_SLUGS, StoryStyleSchema } from '@sleep-stories/contracts';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OnboardingHeader } from '../../features/onboarding/OnboardingHeader';
import {
  isInterestsStepValid,
  useOnboardingStore,
} from '../../features/onboarding/onboarding-store';
import { interestCopy, strings, styleCopy } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StepHeading } from '../../ui/StepHeading';

// Step 2 of 3: interest chips and story styles. "Дальше" needs at least one of each.
// Going back keeps the selections: they live in the onboarding store, not in this screen.
export default function InterestsStep() {
  const router = useRouter();
  const interestSlugs = useOnboardingStore((state) => state.interestSlugs);
  const selectedStyles = useOnboardingStore((state) => state.styles);
  const toggleInterest = useOnboardingStore((state) => state.toggleInterest);
  const toggleStyle = useOnboardingStore((state) => state.toggleStyle);
  const valid = useOnboardingStore(isInterestsStepValid);

  return (
    <Screen scroll header={<OnboardingHeader step={2} onBack={() => router.back()} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(2, 3)}
        title={strings.onboarding.interests.title}
        subtitle={strings.onboarding.interests.subtitle}
      />
      <View style={styles.chips}>
        {PLACEHOLDER_INTEREST_SLUGS.map((slug) => (
          <Chip
            key={slug}
            label={interestCopy[slug]}
            selected={interestSlugs.includes(slug)}
            onPress={() => toggleInterest(slug)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{strings.onboarding.interests.stylesHeading}</Text>
      <View style={styles.styleList}>
        {StoryStyleSchema.options.map((style) => {
          const selected = selectedStyles.includes(style);
          return (
            <Pressable
              key={style}
              accessibilityRole="checkbox"
              accessibilityLabel={`${styleCopy[style].label}, ${styleCopy[style].description}`}
              accessibilityState={{ checked: selected }}
              onPress={() => toggleStyle(style)}
              style={styles.styleRow}
            >
              <View style={styles.styleTexts}>
                <Text style={styles.styleLabel}>
                  {styleCopy[style].label}
                </Text>
                <Text style={styles.styleDescription}>{styleCopy[style].description}</Text>
              </View>
              <View style={[styles.box, selected && styles.boxOn]}>
                {selected ? <Icon name="check" size={14} color={colors.accent} /> : null}
              </View>
            </Pressable>
          );
        })}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xl },
  sectionLabel: {
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: spacing.xxl - 4,
  },
  styleList: { marginTop: 6 },
  styleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  styleTexts: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  styleLabel: { color: colors.text, fontSize: typeSizes.input, fontWeight: '500' },
  styleDescription: { color: colors.muted, fontSize: typeSizes.small },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.radioBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.accent },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});

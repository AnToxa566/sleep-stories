import { CUSTOM_INTEREST_MAX_LENGTH, StoryStyleSchema } from '@sleep-stories/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useInterests } from '../../api/queries';
import { resolveInterestEntry } from '../../features/onboarding/catalogue-match';
import { displayCustomTitle } from '../../features/onboarding/display-title';
import { OnboardingHeader } from '../../features/onboarding/OnboardingHeader';
import {
  isInterestsStepValid,
  useOnboardingStore,
} from '../../features/onboarding/onboarding-store';
import { strings, styleCopy } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { StepHeading } from '../../ui/StepHeading';

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
  const [customText, setCustomText] = useState('');

  // A topic equal to a catalogue title selects that chip instead (the API would refuse it as
  // a custom topic). Otherwise the store normalises, drops blanks, duplicates and anything
  // over the cap; the field is cleared only when a topic was really added, so a rejected
  // entry stays visible.
  const addCustom = () => {
    const entry = resolveInterestEntry(customText, interests.data?.interests ?? [], interestSlugs);
    if (entry.kind === 'catalogue') {
      if (!entry.alreadySelected) toggleInterest(entry.slug);
      setCustomText('');
      return;
    }
    if (addCustomInterest(customText)) setCustomText('');
  };

  return (
    <Screen scroll header={<OnboardingHeader step={2} onBack={() => router.back()} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(2, 3)}
        title={strings.onboarding.interests.title}
        subtitle={strings.onboarding.interests.subtitle}
      />
      {interests.isPending ? (
        <View style={styles.status} accessibilityRole="progressbar">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.statusText}>{strings.onboarding.interests.loading}</Text>
        </View>
      ) : interests.isError ? (
        <View style={styles.status}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {strings.onboarding.interests.loadFailed}
          </Text>
          <SecondaryButton label={strings.common.retry} onPress={() => void interests.refetch()} />
        </View>
      ) : (
        <View style={styles.chips}>
          {interests.data.interests.map(({ slug, title }) => (
            <Chip
              key={slug}
              label={title}
              selected={interestSlugs.includes(slug)}
              onPress={() => toggleInterest(slug)}
            />
          ))}
        </View>
      )}

      {customInterests.length > 0 ? (
        <View style={[styles.chips, styles.customChips]}>
          {customInterests.map((text) => (
            <Chip
              key={text}
              label={displayCustomTitle(text)}
              hint={strings.onboarding.interests.removeCustomLabel}
              selected
              onPress={() => removeCustomInterest(text)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.customRow}>
        <TextInput
          accessibilityLabel={strings.onboarding.interests.customPlaceholder}
          placeholder={strings.onboarding.interests.customPlaceholder}
          placeholderTextColor={colors.placeholder}
          selectionColor={colors.accent}
          value={customText}
          onChangeText={setCustomText}
          onSubmitEditing={addCustom}
          maxLength={CUSTOM_INTEREST_MAX_LENGTH}
          returnKeyType="done"
          // Keeps the keyboard open so several topics can be typed in a row.
          submitBehavior="submit"
          style={styles.customInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.onboarding.interests.addCustomLabel}
          onPress={addCustom}
          style={styles.addButton}
        >
          <Icon name="plus" size={20} color={colors.accent} />
        </Pressable>
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
  customChips: { marginTop: spacing.sm },
  status: { marginTop: spacing.xl, gap: spacing.lg, alignItems: 'flex-start' },
  statusText: { color: colors.muted, fontSize: typeSizes.body },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  customInput: {
    flex: 1,
    height: 46,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: typeSizes.input,
  },
  addButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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

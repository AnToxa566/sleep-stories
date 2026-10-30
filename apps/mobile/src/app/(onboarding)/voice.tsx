import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVoices } from '../../api/queries';
import { OnboardingHeader } from '../../features/onboarding/OnboardingHeader';
import { useOnboardingStore } from '../../features/onboarding/onboarding-store';
import { strings } from '../../strings';
import { colors, minTouchTarget, spacing, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { SelectRow } from '../../ui/SelectRow';
import { StepHeading } from '../../ui/StepHeading';

// Step 1 of 3. Voices come from GET /voices. The sample play control is drawn but does nothing
// (no audio in this feature). The primary action, "Дальше", stays disabled until the chosen
// voice is one the server returned (a slug kept from an older list does not count).
export default function VoiceStep() {
  const router = useRouter();
  const voiceSlug = useOnboardingStore((state) => state.voiceSlug);
  const selectVoice = useOnboardingStore((state) => state.selectVoice);
  const voices = useVoices();
  const valid = voices.data?.voices.some((voice) => voice.slug === voiceSlug) ?? false;

  return (
    <Screen scroll header={<OnboardingHeader step={1} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(1, 3)}
        title={strings.onboarding.voice.title}
        subtitle={strings.onboarding.voice.subtitle}
      />
      {voices.isPending ? (
        <View style={styles.status} accessibilityRole="progressbar">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.statusText}>{strings.onboarding.voice.loading}</Text>
        </View>
      ) : voices.isError ? (
        <View style={styles.status}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {strings.onboarding.voice.loadFailed}
          </Text>
          <SecondaryButton label={strings.common.retry} onPress={() => void voices.refetch()} />
        </View>
      ) : (
        <View style={styles.list}>
          {voices.data.voices.map(({ slug, name, description }) => (
            <SelectRow
              key={slug}
              title={name}
              description={description}
              selected={voiceSlug === slug}
              onPress={() => selectVoice(slug)}
              leading={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.onboarding.voice.playSample}: ${name}`}
                  onPress={noop}
                  style={styles.play}
                >
                  <Icon name="play" size={18} />
                </Pressable>
              }
            />
          ))}
        </View>
      )}
      <View style={styles.bottom}>
        <PrimaryButton
          label={strings.common.next}
          disabled={!valid}
          onPress={() => router.push('/interests')}
        />
      </View>
    </Screen>
  );
}

function noop(): void {
  // Intentionally empty: no voice sample yet.
}

const styles = StyleSheet.create({
  list: { marginTop: 26, borderTopWidth: 1, borderTopColor: colors.hairline },
  status: { marginTop: spacing.xl, gap: spacing.lg, alignItems: 'flex-start' },
  statusText: { color: colors.muted, fontSize: typeSizes.body },
  play: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});

import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVoices } from '../../api/queries';
import { OnboardingHeader } from '../../features/onboarding/OnboardingHeader';
import { useOnboardingStore } from '../../features/onboarding/onboarding-store';
import { useVoiceSample } from '../../features/onboarding/useVoiceSample';
import { strings } from '../../strings';
import { colors, minTouchTarget, spacing, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { SelectRow } from '../../ui/SelectRow';
import { StepHeading } from '../../ui/StepHeading';

// Step 1 of 3. Voices come from GET /voices. The round control on each row plays that voice's
// sample (one at a time, see useVoiceSample) and does not select the row; tapping the row
// selects. While a sample plays the same control shows a pause icon (owner's choice; the design
// shows the small orb there). The primary action, "Дальше", stays disabled until the chosen
// voice is one the server returned (a slug kept from an older list does not count).
export default function VoiceStep() {
  const router = useRouter();
  const voiceSlug = useOnboardingStore((state) => state.voiceSlug);
  const selectVoice = useOnboardingStore((state) => state.selectVoice);
  const voices = useVoices();
  const valid = voices.data?.voices.some((voice) => voice.slug === voiceSlug) ?? false;
  const sample = useVoiceSample();

  return (
    <Screen scroll header={<OnboardingHeader step={1} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(1, 3)}
        title={strings.onboarding.voice.title}
        subtitle={strings.onboarding.voice.subtitle}
      />
      {voices.data === undefined && voices.isError ? (
        <View style={styles.status}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {strings.onboarding.voice.loadFailed}
          </Text>
          <SecondaryButton label={strings.common.retry} onPress={() => void voices.refetch()} />
        </View>
      ) : voices.data === undefined ? (
        <View style={styles.status} accessibilityRole="progressbar">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.statusText}>{strings.onboarding.voice.loading}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {voices.data.voices.map(({ slug, name, description, sampleUrl }) => {
            const playing = sample.playingSlug === slug;
            return (
              <SelectRow
                key={slug}
                title={name}
                description={description}
                selected={voiceSlug === slug}
                onPress={() => selectVoice(slug)}
                leading={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${
                      playing
                        ? strings.onboarding.voice.stopSample
                        : strings.onboarding.voice.playSample
                    }: ${name}`}
                    onPress={() => sample.toggle({ slug, sampleUrl })}
                    style={styles.play}
                  >
                    <Icon name={playing ? 'pause' : 'play'} size={18} />
                  </Pressable>
                }
              />
            );
          })}
          {sample.failed ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {strings.onboarding.voice.playFailed}
            </Text>
          ) : null}
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
  error: {
    color: colors.danger,
    fontSize: typeSizes.small,
    paddingTop: spacing.lg,
  },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});

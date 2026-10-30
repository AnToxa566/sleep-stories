import { PLACEHOLDER_VOICE_SLUGS } from '@sleep-stories/contracts';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { OnboardingHeader } from '../../features/onboarding/OnboardingHeader';
import {
  isVoiceStepValid,
  useOnboardingStore,
} from '../../features/onboarding/onboarding-store';
import { strings, voiceCopy } from '../../strings';
import { colors, minTouchTarget, spacing } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { SelectRow } from '../../ui/SelectRow';
import { StepHeading } from '../../ui/StepHeading';

// Step 1 of 3. The sample play control is drawn but does nothing (no audio in this feature).
// The primary action, "Дальше", stays disabled until a voice is chosen.
export default function VoiceStep() {
  const router = useRouter();
  const voiceSlug = useOnboardingStore((state) => state.voiceSlug);
  const selectVoice = useOnboardingStore((state) => state.selectVoice);
  const valid = useOnboardingStore(isVoiceStepValid);

  return (
    <Screen scroll header={<OnboardingHeader step={1} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(1, 3)}
        title={strings.onboarding.voice.title}
        subtitle={strings.onboarding.voice.subtitle}
      />
      <View style={styles.list}>
        {PLACEHOLDER_VOICE_SLUGS.map((slug) => (
          <SelectRow
            key={slug}
            title={voiceCopy[slug].name}
            description={voiceCopy[slug].description}
            selected={voiceSlug === slug}
            onPress={() => selectVoice(slug)}
            leading={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${strings.onboarding.voice.playSample}: ${voiceCopy[slug].name}`}
                onPress={noop}
                style={styles.play}
              >
                <Icon name="play" size={18} />
              </Pressable>
            }
          />
        ))}
      </View>
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

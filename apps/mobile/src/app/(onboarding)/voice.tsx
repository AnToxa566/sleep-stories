import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useVoices, voicesQueryKey } from '../../api/queries';
import { OnboardingHeader } from '../../features/onboarding/steps/OnboardingHeader';
import { useOnboardingStore } from '../../features/onboarding/onboarding-store';
import { strings } from '../../strings';
import { spacing } from '../../theme/tokens';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { Screen } from '../../ui/layout/Screen';
import { useVoiceSample } from '../../ui/voice/useVoiceSample';
import { VoiceList } from '../../ui/voice/VoiceList';
import { StepHeading } from '../../features/onboarding/steps/StepHeading';

// Step 1 of 3. Voices come from GET /voices; the list and the sample playback are shared
// (ui/voice). The primary action, "Дальше", stays disabled until the chosen voice is one the
// server returned (a slug kept from an older list does not count).
export default function VoiceStep() {
  const router = useRouter();
  const voiceSlug = useOnboardingStore((state) => state.voiceSlug);
  const selectVoice = useOnboardingStore((state) => state.selectVoice);
  const voices = useVoices();
  const valid = voices.data?.voices.some((voice) => voice.slug === voiceSlug) ?? false;
  const queryClient = useQueryClient();
  const sample = useVoiceSample(
    () => void queryClient.invalidateQueries({ queryKey: voicesQueryKey }),
  );

  return (
    <Screen scroll header={<OnboardingHeader step={1} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(1, 3)}
        title={strings.onboarding.voice.title}
        subtitle={strings.onboarding.voice.subtitle}
      />
      <VoiceList
        voices={voices.data?.voices}
        loadError={voices.isError}
        onRetry={() => void voices.refetch()}
        selectedSlug={voiceSlug}
        onSelect={selectVoice}
        playingSlug={sample.playingSlug}
        onToggleSample={sample.toggle}
        playFailed={sample.failed}
      />
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
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});

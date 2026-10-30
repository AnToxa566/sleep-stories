import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useCompleteOnboarding } from '../../api/queries';
import { OnboardingHeader } from '../../features/onboarding/OnboardingHeader';
import { onboardingErrorMessage } from '../../features/onboarding/onboarding-errors';
import { useOnboardingStore } from '../../features/onboarding/onboarding-store';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StaticToggle } from '../../ui/StaticToggle';
import { StepHeading } from '../../ui/StepHeading';

// Step 3 of 3. Only the notifications / "Не беспокоить" row is drawn, with a toggle that
// takes no presses and carries no logic. "Готово" sends all the answers in one request;
// on success the response fills the 'me' cache and the gate moves to Home by itself, so
// nothing navigates here. On failure the answers stay and an error is shown.
export default function PermissionsStep() {
  const router = useRouter();
  const complete = useCompleteOnboarding();

  const done = () => {
    // A second tap while a request is pending is ignored (the button is disabled as well).
    if (complete.isPending) return;
    const request = useOnboardingStore.getState().buildRequest();
    if (request) complete.mutate(request);
  };

  return (
    <Screen scroll header={<OnboardingHeader step={3} onBack={() => router.back()} />}>
      <StepHeading
        eyebrow={strings.onboarding.stepOf(3, 3)}
        title={strings.onboarding.permissions.title}
      />
      <View style={styles.list}>
        <View style={styles.row}>
          <View style={styles.iconCircle}>
            <Icon name="bell" size={20} />
          </View>
          <View style={styles.texts}>
            <Text style={styles.rowTitle}>{strings.onboarding.permissions.doNotDisturbTitle}</Text>
            <Text style={styles.rowBody}>{strings.onboarding.permissions.doNotDisturbBody}</Text>
          </View>
          <StaticToggle on={false} label={strings.onboarding.permissions.doNotDisturbTitle} />
        </View>
      </View>

      <View style={styles.bottom}>
        {complete.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {onboardingErrorMessage(complete.error)}
          </Text>
        ) : null}
        <Text style={styles.footnote}>{strings.onboarding.permissions.footnote}</Text>
        <PrimaryButton
          label={strings.onboarding.permissions.done}
          loading={complete.isPending}
          onPress={done}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 30, borderTopWidth: 1, borderTopColor: colors.hairline },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, gap: 6, paddingTop: 2 },
  rowTitle: { color: colors.text, fontSize: typeSizes.input, fontWeight: '500' },
  rowBody: { color: colors.muted, fontSize: typeSizes.small, lineHeight: 21 },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl, gap: 14 },
  error: { color: colors.danger, fontSize: typeSizes.small, textAlign: 'center' },
  footnote: { color: colors.muted, fontSize: typeSizes.caption, textAlign: 'center' },
});

import { StyleSheet, View } from 'react-native';
import { strings } from '../../strings';
import { spacing } from '../../theme/tokens';
import { BackButton } from '../../ui/BackButton';
import { ProgressSegments } from '../../ui/ProgressSegments';

type Props = {
  step: 1 | 2 | 3;
  // Absent on the first step: there is nothing to go back to.
  onBack?: () => void;
};

export const ONBOARDING_STEPS = 3;

// Back button (steps 2 and 3) and the progress segments in one row, laid out as the reset-password
// steps in the designs: 52 px high, 16 px left margin, 8 px between the button and the bars.
export function OnboardingHeader({ step, onBack }: Props) {
  return (
    <View style={onBack ? styles.rowWithBack : styles.row}>
      {onBack ? <BackButton label={strings.common.back} onPress={onBack} /> : null}
      <View style={onBack ? styles.progressWithBack : styles.progress}>
        <ProgressSegments current={step} total={ONBOARDING_STEPS} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingTop: 14 },
  rowWithBack: { flexDirection: 'row', alignItems: 'center', height: 52, paddingTop: 4, paddingLeft: spacing.lg, gap: spacing.sm },
  // The segments' own row is `flex: 1`; with no back button they get the screen's 28 px margin.
  progress: { flex: 1, height: 12, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  progressWithBack: { flex: 1, height: 44, paddingRight: 12, justifyContent: 'center' },
});

import { StyleSheet, View } from 'react-native';
import { colors, radii, sizes } from '../theme/tokens';

type Props = {
  // 1-based index of the current step, and the number of steps.
  current: number;
  total: number;
};

// Thin bar per step: filled up to and including the current one.
export function ProgressSegments({ current, total }: Props) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current }}
      style={styles.row}
    >
      {new Array<null>(total).fill(null).map((_, i) => (
        <View key={i} style={[styles.segment, i < current && styles.segmentOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  segment: {
    flex: 1,
    height: sizes.segmentHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.segmentOff,
  },
  segmentOn: { backgroundColor: colors.accent },
});

import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';

type Props = {
  on: boolean;
  label: string;
};

// A switch that only shows a state. It takes no presses: the permission it stands for is
// not wired yet, and a control that does nothing must not look pressable to a screen reader.
export function StaticToggle({ on, label }: Props) {
  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled: true }}
      pointerEvents="none"
      style={[styles.track, on && styles.trackOn]}
    >
      <View style={[styles.knob, on ? styles.knobOn : styles.knobOff]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.toggleOff,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: colors.accent },
  knob: { position: 'absolute', top: 3, width: 20, height: 20, borderRadius: 10 },
  knobOn: { left: 21, backgroundColor: colors.onAccent },
  knobOff: { left: 3, backgroundColor: colors.muted },
});

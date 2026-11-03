import { Pressable, StyleSheet } from 'react-native';
import { colors } from '../../theme/tokens';
import { Orb } from '../../ui/Orb';

type Props = {
  // A touch anywhere. It leaves the dimmed look: back to the player view, or to 3c during the
  // waves. Playback is not paused and nothing is continued.
  onPress: () => void;
  accessibilityLabel: string;
};

// The dimmed look (design 3b): near-black page, the orb at low opacity. The whole screen is
// one touch target.
export function DimView({ onPress, accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.fill}
    >
      <Orb size={240} dim />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dimBase,
  },
});

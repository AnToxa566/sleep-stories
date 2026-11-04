import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { strings } from '../../strings';
import { colors, minTouchTarget, spacing } from '../../theme/tokens';
import { BackButton } from '../../ui/BackButton';
import { Icon } from '../../ui/icons';

type Props = {
  // «1 / 3»
  label: string;
  // The arrow: leave the player, stop everything.
  onLeave: () => void;
  // The moon button (the dimmed look). Absent during the waves: the header keeps its shape.
  onDim?: () => void;
};

// The header of the player (designs 3a and 3c): the arrow on the left, «N / M» in the middle and
// the moon on the right. The arrow points left, as everywhere in the app: it leaves the player.
export function PlayerHeader({ label, onLeave, onDim }: Props) {
  return (
    // box-none: the empty parts of the header pass a touch to the layer behind it (the waves screen).
    <View pointerEvents="box-none" style={styles.row}>
      <BackButton label={strings.player.a11y.leave} onPress={onLeave} />
      <View pointerEvents="none">
        <Text style={styles.label}>{label}</Text>
      </View>
      {onDim ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.player.a11y.dim}
          onPress={onDim}
          style={({ pressed }) => [styles.slot, pressed && styles.pressed]}
        >
          <Icon name="moon" size={20} />
        </Pressable>
      ) : (
        <View style={styles.slot} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 52,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    letterSpacing: 1.6,
    fontVariant: ['tabular-nums'],
  },
  slot: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});

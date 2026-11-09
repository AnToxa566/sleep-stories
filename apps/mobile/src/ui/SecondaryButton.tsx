import { Pressable, StyleSheet } from 'react-native';
import { Text } from './typography';
import { colors, radii, sizes, spacing, typeSizes } from '../theme/tokens';
import { Icon, type IconName } from './icons';

type Props = {
  label: string;
  onPress: () => void;
  // An optional icon before the label, drawn in the accent colour (design frame 2a·1: a plus).
  icon?: IconName;
};

// Outlined pill for actions that are not the screen's primary one.
export function SecondaryButton({ label, onPress, icon }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {icon ? <Icon name={icon} size={16} color={colors.accent} strokeWidth={1.8} /> : null}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: sizes.secondaryButtonHeight,
    // Without side padding the label touches the border whenever a parent shrinks the button
    // to its content (alignItems: 'flex-start' on the error blocks). In a full-width parent
    // the button stretches and the padding changes nothing.
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.buttonSmall,
    borderWidth: 1,
    borderColor: colors.outline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: { opacity: 0.7 },
  label: {
    color: colors.textSoft,
    fontSize: typeSizes.bodyLarge,
    fontWeight: '500',
  },
});

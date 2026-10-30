import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, sizes, typeSizes } from '../theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
};

// Outlined pill for actions that are not the screen's primary one.
export function SecondaryButton({ label, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: sizes.secondaryButtonHeight,
    borderRadius: radii.buttonSmall,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  label: {
    color: colors.textSoft,
    fontSize: typeSizes.bodyLarge,
    fontWeight: '500',
  },
});

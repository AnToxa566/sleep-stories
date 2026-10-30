import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, sizes, typeSizes } from '../theme/tokens';

type Props = {
  label: string;
  selected: boolean;
  // Spoken hint for screen readers (what a press does).
  hint?: string;
  onPress: () => void;
};

// Selectable pill. It is drawn 40 px tall as in the design; hitSlop brings the touch
// target to 44 px.
export function Chip({ label, selected, hint, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: selected }}
      hitSlop={{ top: 2, bottom: 2 }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: sizes.chipHeight,
    paddingHorizontal: 16,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.outlineSoft,
    justifyContent: 'center',
  },
  chipOn: {
    borderColor: colors.accentOutline,
    backgroundColor: colors.accentTint,
  },
  label: { color: colors.textSoft, fontSize: typeSizes.body },
  labelOn: { color: colors.accent },
});

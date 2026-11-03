import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, sizes, typeSizes } from '../theme/tokens';
import { Icon } from './icons';

type Props = {
  label: string;
  selected: boolean;
  // Spoken hint for screen readers (what a press does).
  hint?: string;
  // A chip that opens a sheet instead of toggling: a small chevron after the label and the
  // role of a button (the filter chips of «Темы» and «Замена»). `selected` then means "a
  // choice is on" and only highlights the chip.
  opensSheet?: boolean;
  onPress: () => void;
};

// Selectable pill. It is drawn 40 px tall as in the design; hitSlop brings the touch
// target to 44 px.
export function Chip({ label, selected, hint, opensSheet = false, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole={opensSheet ? 'button' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={opensSheet ? { selected } : { checked: selected }}
      hitSlop={{ top: 2, bottom: 2 }}
      onPress={onPress}
      style={[styles.chip, opensSheet && styles.chipWithIcon, selected && styles.chipOn]}
    >
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
      {opensSheet ? (
        <Icon name="chevronDown" size={14} color={selected ? colors.accent : colors.textSoft} />
      ) : null}
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
  // Design: 14 px before the label, 10 px after the chevron, 4 px between them.
  chipWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: 10,
  },
  chipOn: {
    borderColor: colors.accentOutline,
    backgroundColor: colors.accentTint,
  },
  label: { color: colors.textSoft, fontSize: typeSizes.body },
  labelOn: { color: colors.accent },
});

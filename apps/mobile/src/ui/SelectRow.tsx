import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, sizes, typeSizes } from '../theme/tokens';

type Props = {
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  // Optional control drawn before the text (for example a play button). It handles its own presses.
  leading?: ReactNode;
};

// One row of a single-choice list (radio): title, description and a radio dot on the right.
export function SelectRow({ title, description, selected, onPress, leading }: Props) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={description ? `${title}, ${description}` : title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.row}
    >
      {leading}
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    height: sizes.rowHeight,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  texts: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: typeSizes.input, fontWeight: '500' },
  description: { color: colors.muted, fontSize: typeSizes.small },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.radioBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.accent },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});

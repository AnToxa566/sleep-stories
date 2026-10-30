import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, minTouchTarget, typeSizes } from '../theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
};

export function TextLink({ label, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
  label: { color: colors.textSoft, fontSize: typeSizes.small },
});

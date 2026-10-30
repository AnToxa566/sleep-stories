import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, minTouchTarget, typeSizes } from '../theme/tokens';

type Props = {
  // The muted question and the brighter action, e.g. "Нет аккаунта?" + "Создать".
  prompt: string;
  action: string;
  onPress: () => void;
};

// The two-tone link at the bottom of the sign-in and sign-up screens: the whole row is one
// touch target, read by screen readers as a single link.
export function PromptLink({ prompt, action, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${prompt} ${action}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={styles.prompt}>{prompt}</Text>
      <Text style={styles.action}>{action}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pressed: { opacity: 0.7 },
  prompt: { color: colors.muted, fontSize: typeSizes.small },
  action: { color: colors.textSoft, fontSize: typeSizes.small },
});

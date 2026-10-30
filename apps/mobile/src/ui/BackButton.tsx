import { Pressable, StyleSheet } from 'react-native';
import { Icon } from './icons';
import { minTouchTarget } from '../theme/tokens';

type Props = {
  onPress: () => void;
  label: string;
};

export function BackButton({ onPress, label }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon name="back" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});

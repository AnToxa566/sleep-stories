import { Pressable, StyleSheet, Text } from 'react-native';
import { strings } from '../../strings';
import { colors } from '../../theme/tokens';
import { Orb } from '../../ui/Orb';

type Props = {
  // A touch anywhere: the person is awake, back to «Сегодня».
  onPress: () => void;
};

// The asleep screen (design 3d): as dark as the app gets. The coloured part of the orb is gone
// and the only text is a very dim «Спокойной ночи» (the design's «Засыпаю» label is not used).
export function AsleepView({ onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.player.a11y.wake}
      onPress={onPress}
      style={styles.fill}
    >
      <Orb size={200} asleep />
      <Text style={styles.text}>{strings.player.asleep}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 56,
    backgroundColor: colors.asleepBase,
  },
  text: { color: colors.asleepText, fontSize: 15 },
});

import { StyleSheet, View } from 'react-native';
import { Text } from './typography';
import { colors, typeSizes } from '../theme/tokens';
import { Icon } from './icons';

// «· ✓ Прослушана» at the end of the data line of a story row (queue, topics, replace): a
// separator dot, a check icon, then the label. The caller passes its own string.
export function HeardMark({ label }: { label: string }) {
  return (
    <>
      <Text style={styles.text}>·</Text>
      <View style={styles.mark}>
        <Icon name="check" size={13} color={colors.muted} strokeWidth={2} />
        <Text style={styles.text}>{label}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { color: colors.muted, fontSize: typeSizes.small, fontVariant: ['tabular-nums'] },
});

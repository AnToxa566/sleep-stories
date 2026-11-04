import { StyleSheet, View } from 'react-native';
import { Text } from './typography';
import { colors, typeSizes } from '../theme/tokens';

const WIDTHS = ['72%', '58%', '66%'] as const;

type Props = {
  count: number;
  // Draw the row number («01») in front of the lines, as the queue does. Off for plain lists.
  numbered?: boolean;
};

// Placeholder rows shown while a list loads for the first time (and in the collecting state of
// the empty queue): a grey title line and a shorter meta line per row. Hidden from screen
// readers; they carry no information.
export function SkeletonRows({ count, numbered = true }: Props) {
  return (
    <View
      style={styles.rows}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          {numbered ? <Text style={styles.number}>{String(index + 1).padStart(2, '0')}</Text> : null}
          <View style={styles.lines}>
            <View style={[styles.lineTitle, { width: WIDTHS[index % WIDTHS.length] }]} />
            <View style={styles.lineMeta} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { borderTopWidth: 1, borderTopColor: colors.hairline },
  row: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  number: {
    width: 28,
    color: colors.accentOutline,
    fontSize: typeSizes.body,
    fontVariant: ['tabular-nums'],
  },
  lines: { flex: 1, gap: 9 },
  lineTitle: { height: 12, borderRadius: 6, backgroundColor: colors.skeleton },
  lineMeta: { height: 10, width: '30%', borderRadius: 5, backgroundColor: colors.skeletonSoft },
});

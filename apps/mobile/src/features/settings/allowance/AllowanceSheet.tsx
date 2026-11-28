import type { QueueResponse } from '@sleep-stories/contracts';
import { StyleSheet, View } from 'react-native';
import { formatClock } from '../../../format/clock/clock';
import { strings } from '../../../strings';
import { colors, typeSizes } from '../../../theme/tokens';
import { SecondaryButton } from '../../../ui/buttons/SecondaryButton';
import { BottomSheet } from '../../../ui/layout/BottomSheet';
import { Text } from '../../../ui/typography/typography';
import { allowanceSheetView } from './allowance-view';

type Props = {
  visible: boolean;
  generations: QueueResponse['generations'] | undefined;
  onClose: () => void;
};

// The sheet of «Генерации» (design frame 4b·1). «Now» is the moment of this render: opening
// the sheet and a new queue answer render it again. There is no timer and no countdown.
export function AllowanceSheet({ visible, generations, onClose }: Props) {
  const view = generations ? allowanceSheetView(generations, new Date(), formatClock) : null;
  return (
    <BottomSheet visible={visible && view !== null} onClose={onClose}>
      {view ? (
        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>
            {view.title}
          </Text>
          {view.lines.map((line) => (
            <Text key={line.lead} style={styles.line}>
              {line.lead}{' '}
              <Text style={styles.time}>{line.time}</Text>.
            </Text>
          ))}
        </View>
      ) : null}
      <SecondaryButton label={strings.settings.allowanceSheet.dismiss} onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, paddingTop: 20, paddingBottom: 24 },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  line: {
    color: colors.muted,
    fontSize: typeSizes.body,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  // The design says 600; the heaviest bundled Onest is 500. A nested Text picks its font from
  // its own weight.
  time: { color: colors.text, fontWeight: '500', fontVariant: ['tabular-nums'] },
});

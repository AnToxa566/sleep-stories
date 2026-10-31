import { Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../../strings';
import { colors, minTouchTarget, spacing, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { queuePlateText, showQueuePlate } from './topic-rows';

// Height of the plate in the design (frame s-topics).
export const QUEUE_PLATE_HEIGHT = 56;

type Props = {
  // How many items the queue holds. The plate is not drawn for an empty queue.
  count: number;
  // «К очереди»: goes back to «Сегодня».
  onOpenQueue: () => void;
};

// «В очереди: N» with a «К очереди» link, resting on the bottom bar. The bar is below the
// scene in the tabs layout, so the plate sits at the bottom edge of the scene. Absolute-
// positioned: the parent reserves QUEUE_PLATE_HEIGHT for the list's last row.
export function QueuePlate({ count, onOpenQueue }: Props) {
  if (!showQueuePlate(count)) return null;
  return (
    <View style={styles.plate}>
      <Text style={styles.text}>{queuePlateText(count)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.topics.plate.toQueue}
        onPress={onOpenQueue}
        style={styles.link}
      >
        <Text style={styles.linkLabel}>{strings.topics.plate.toQueue}</Text>
        <Icon name="arrowRight" size={16} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: QUEUE_PLATE_HEIGHT,
    paddingLeft: spacing.xxl,
    paddingRight: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.plate,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  text: { color: colors.textSoft, fontSize: typeSizes.body, fontVariant: ['tabular-nums'] },
  link: {
    height: minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  linkLabel: { color: colors.accent, fontSize: typeSizes.body, fontWeight: '500' },
});

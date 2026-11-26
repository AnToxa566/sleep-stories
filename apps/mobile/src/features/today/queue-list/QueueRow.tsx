import type { QueueItem } from '@sleep-stories/contracts';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../../../ui/typography/typography';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useIsActive, useReorderableDrag } from 'react-native-reorderable-list';
import { scheduleOnRN } from 'react-native-worklets';
import { strings } from '../../../strings';
import { colors, spacing, typeSizes } from '../../../theme/tokens';
import { HeardMark } from '../../../ui/status/HeardMark';
import { Icon } from '../../../ui/icons/icons';
import { formatPosition } from '../../../format/plural';
import { deriveRow } from './rows';

// How long a row must be held still before it can be dragged. Tune it here. React Native's own
// default is 500. A finger that moves more than 10 points before this cancels the hold, so a
// scroll or a swipe does not start a drag.
const HOLD_TO_DRAG_MS = 500;
// Width of the «Убрать» button revealed by a swipe left (design frame 2a·7).
export const REMOVE_WIDTH = 96;
// Past this share of the row width a swipe removes the row without a tap.
const FULL_SWIPE_FRACTION = 0.6;
// A quick flick beats the distance: faster than this (px/s) opens or closes the row.
const FLICK_VELOCITY = 600;
const SNAP_MS = 180;
// Row side padding of the list; the row is as wide as the window minus both.
const ROW_SIDE_PADDING = spacing.xxl;

type Props = {
  item: QueueItem;
  index: number;
  // The same pan gesture the list was given. The swipe runs beside it, so neither can
  // cancel the other when a horizontal move starts (see QueueList).
  listGesture: PanGesture;
  // True from the moment a hold starts a drag until the row is released (see QueueList).
  dragging: SharedValue<boolean>;
  onOpenMenu: (itemId: string) => void;
  onOpenHint: () => void;
  // «Повторить» on a failed row. A person's tap only.
  onRetry: (itemId: string) => void;
  onRemove: (itemId: string) => void;
};

// One row of the queue. The row body takes three gestures: a tap opens the item menu, a swipe
// left reveals «Убрать», and a hold followed by a move drags the row to a new place. The small
// status button («Не готова» opens the hint, «Повторить» retries) is a separate press target.
// There is no drag handle: the owner's user did not understand it, and it took the right edge,
// where a swipe left naturally starts (2026-11-26).
export const QueueRow = memo(function QueueRow({
  item,
  index,
  listGesture,
  dragging,
  onOpenMenu,
  onOpenHint,
  onRetry,
  onRemove,
}: Props) {
  const row = deriveRow(item);
  const drag = useReorderableDrag();
  const lifted = useIsActive();
  const { width } = useWindowDimensions();
  const fullDistance = Math.max(width - ROW_SIDE_PADDING * 2, REMOVE_WIDTH * 2);

  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  // Set when a drag happened during the current touch. The swipe cannot rely on `dragging`
  // alone: on release the list may clear it before the swipe's `onEnd` runs.
  const swipeBlocked = useSharedValue(false);

  const itemId = item.id;
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        // Horizontal intent only: a vertical move fails this gesture at once and leaves
        // the touch to the list scroll.
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .simultaneousWithExternalGesture(listGesture)
        .onBegin(() => {
          'worklet';
          startX.value = translateX.value;
          swipeBlocked.value = false;
        })
        .onUpdate((event) => {
          'worklet';
          // A finger drifting sideways during a drag must not pull the row aside.
          if (dragging.value) swipeBlocked.value = true;
          if (swipeBlocked.value) return;
          translateX.value = Math.max(
            -fullDistance,
            Math.min(0, startX.value + event.translationX),
          );
        })
        .onEnd((event) => {
          'worklet';
          if (swipeBlocked.value || dragging.value) return;
          const x = translateX.value;
          if (x < -fullDistance * FULL_SWIPE_FRACTION) {
            translateX.value = withTiming(-fullDistance, { duration: SNAP_MS });
            scheduleOnRN(onRemove, itemId);
          } else if (event.velocityX > FLICK_VELOCITY) {
            translateX.value = withTiming(0, { duration: SNAP_MS });
          } else if (event.velocityX < -FLICK_VELOCITY || x < -REMOVE_WIDTH / 2) {
            translateX.value = withTiming(-REMOVE_WIDTH, { duration: SNAP_MS });
          } else {
            translateX.value = withTiming(0, { duration: SNAP_MS });
          }
        }),
    [listGesture, fullDistance, startX, translateX, dragging, swipeBlocked, onRemove, itemId],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  // The red strip is exactly as wide as the swipe, so it never overlaps the row. Its content
  // keeps a fixed width inside, right-aligned, and is clipped while the swipe is partial.
  const removeStyle = useAnimatedStyle(() => ({
    width: Math.max(0, -translateX.value),
  }));

  const openMenu = useCallback(() => {
    // A tap on an open row only closes it.
    if (translateX.value < -1) {
      translateX.value = withTiming(0, { duration: SNAP_MS });
      return;
    }
    onOpenMenu(itemId);
  }, [onOpenMenu, itemId, translateX]);

  const dragByHold = useCallback(() => {
    // An open row closes before it is lifted.
    translateX.value = withTiming(0, { duration: SNAP_MS });
    drag();
  }, [drag, translateX]);

  const removeByTap = useCallback(() => onRemove(itemId), [onRemove, itemId]);
  const retry = useCallback(() => onRetry(itemId), [onRetry, itemId]);

  return (
    <View style={[styles.cell, lifted && styles.cellLifted]}>
      <Animated.View style={[styles.removeWrap, removeStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.today.a11y.removeRow(item.title)}
          onPress={removeByTap}
          style={styles.removeButton}
        >
          <Icon name="close" size={18} color={colors.accent} />
          <Text style={styles.removeLabel} numberOfLines={1}>
            {strings.today.queue.remove}
          </Text>
        </Pressable>
      </Animated.View>

      <Animated.View style={[styles.foreground, rowStyle]}>
        <GestureDetector gesture={swipe}>
          <View style={styles.body}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.title}
              accessibilityHint={strings.today.a11y.openMenu}
              onPress={openMenu}
              onLongPress={dragByHold}
              delayLongPress={HOLD_TO_DRAG_MS}
              style={styles.bodyPress}
            >
              <Text style={styles.position}>{formatPosition(index)}</Text>
              <View style={styles.texts}>
                <Text style={[styles.title, row.heard && styles.titleHeard]} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.meta}>
                  <Text style={styles.metaText}>{row.styleLabel}</Text>
                  <Text style={styles.metaText}>·</Text>
                  {row.durationText !== null ? (
                    <Text style={styles.metaText}>{row.durationText}</Text>
                  ) : null}
                  {row.action?.kind === 'hint' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={row.action.label}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 16 }}
                      onPress={onOpenHint}
                      style={styles.status}
                    >
                      <Icon name="circleDashed" size={13} color={colors.muted} />
                      <Text style={styles.metaText}>{row.action.label}</Text>
                    </Pressable>
                  ) : null}
                  {row.statusLabel !== null && item.state === 'creating' ? (
                    <>
                      <Text style={styles.creating}>{row.statusLabel}</Text>
                      <Text style={styles.metaText}>·</Text>
                      <Text style={styles.metaText}>{row.statusDetail}</Text>
                    </>
                  ) : null}
                  {item.state === 'failed' && row.action?.kind === 'retry' ? (
                    <>
                      <Text style={styles.metaText}>{row.statusLabel}</Text>
                      <Text style={styles.metaText}>·</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={row.action.label}
                        hitSlop={{ top: 12, bottom: 12, left: 8, right: 16 }}
                        onPress={retry}
                      >
                        <Text style={styles.retry}>{row.action.label}</Text>
                      </Pressable>
                    </>
                  ) : null}
                  {row.heard ? <HeardMark label={strings.today.row.heard} /> : null}
                </View>
              </View>
            </Pressable>
          </View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  // The row grows with the title (up to two lines, then an ellipsis); 76 is the minimum of the
  // design. The foreground is in the flow and gives the height; the red strip fills the cell.
  cell: {
    minHeight: 76,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  // Opaque, so the rows it passes over do not show through.
  cellLifted: { backgroundColor: colors.sheet },
  removeWrap: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: colors.toastIconAccent,
  },
  removeButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: REMOVE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  removeLabel: { color: colors.accent, fontSize: typeSizes.caption },
  foreground: {
    minHeight: 76,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: { flex: 1, alignSelf: 'stretch' },
  bodyPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  position: {
    width: 28,
    color: colors.accent,
    fontSize: typeSizes.body,
    fontVariant: ['tabular-nums'],
  },
  texts: { flex: 1, minWidth: 0, gap: 5 },
  title: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '500',
  },
  // A heard story: the title is quieter, nothing is disabled.
  titleHeard: { color: colors.muted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 },
  metaText: {
    color: colors.muted,
    fontSize: typeSizes.small,
    fontVariant: ['tabular-nums'],
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  creating: { color: colors.textSoft, fontSize: typeSizes.small },
  retry: { color: colors.accent, fontSize: typeSizes.small },
});

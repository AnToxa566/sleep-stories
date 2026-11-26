import type { QueueItem } from '@sleep-stories/contracts';
import { useCallback, useMemo, type ReactElement } from 'react';
import { StyleSheet, Vibration, type ListRenderItemInfo } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import ReorderableList, { type ReorderableListReorderEvent } from 'react-native-reorderable-list';
import { scheduleOnRN } from 'react-native-worklets';
import { spacing } from '../../theme/tokens';
import { moveItem, itemIds } from './queue-edit';
import { QueueRow } from './QueueRow';

// The buzz that says «the row is lifted, now move it».
const DRAG_VIBRATION_MS = 40;

function vibrateOnLift() {
  Vibration.vibrate(DRAG_VIBRATION_MS);
}

type Props = {
  items: readonly QueueItem[];
  // Everything above the first row (greeting, main button, queue title) scrolls with the list.
  header: ReactElement;
  // Shown instead of rows when the queue is empty.
  empty: ReactElement | null;
  footer: ReactElement | null;
  // Room for the bottom bar under the last row.
  bottomPadding: number;
  // The whole list of item ids in the new order (PUT /queue/order).
  onReorder: (ids: string[]) => void;
  onOpenMenu: (itemId: string) => void;
  onOpenHint: () => void;
  onRetry: (itemId: string) => void;
  onRemove: (itemId: string) => void;
};

// The queue as a reorderable list (react-native-reorderable-list 0.18.1, FlatList based).
//
// Gestures, read from the library source and not verified on a device yet:
// - A drag starts from a hold anywhere on the row body (`useReorderableDrag` in QueueRow, on
//   long press; the delay is `HOLD_TO_DRAG_MS` there). A tap opens the item menu.
// - `dragging` is true from the lift to the release; each row's swipe stands still meanwhile.
// - The library tracks a drag with one pan gesture on the whole list. We hand it our own
//   instance so each row's horizontal swipe can run simultaneously with it
//   (`simultaneousWithExternalGesture`); otherwise whichever pan activates first would cancel
//   the other when a swipe starts.
// - The row's swipe fails on a vertical move, so the list scrolls as usual.
// No pull-to-refresh: on Android a RefreshControl conflicts with this list's pan gesture
// (library README, "Refresh Control"); the queue is read again when the app returns to the
// foreground and by the retry on the load error.
export function QueueList({
  items,
  header,
  empty,
  footer,
  bottomPadding,
  onReorder,
  onOpenMenu,
  onOpenHint,
  onRetry,
  onRemove,
}: Props) {
  const listGesture = useMemo(() => Gesture.Pan(), []);
  const dragging = useSharedValue(false);

  // Both run on the UI thread (the library requires worklets here).
  const handleDragStart = useCallback(() => {
    'worklet';
    dragging.value = true;
    scheduleOnRN(vibrateOnLift);
  }, [dragging]);
  const handleDragEnd = useCallback(() => {
    'worklet';
    dragging.value = false;
  }, [dragging]);

  // The list wants a mutable array; the cache data stays untouched.
  const data = useMemo(() => [...items], [items]);

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      if (from === to) return;
      onReorder(itemIds(moveItem(data, from, to)));
    },
    [data, onReorder],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<QueueItem>) => (
      <QueueRow
        item={item}
        index={index}
        listGesture={listGesture}
        dragging={dragging}
        onOpenMenu={onOpenMenu}
        onOpenHint={onOpenHint}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    ),
    [listGesture, dragging, onOpenMenu, onOpenHint, onRetry, onRemove],
  );

  return (
    <ReorderableList
      data={data}
      // A stable id, never the index (library README).
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      onReorder={handleReorder}
      panGesture={listGesture}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      // Needed by `useIsActive`, which highlights the lifted row.
      shouldUpdateActiveItem
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xxl },
});

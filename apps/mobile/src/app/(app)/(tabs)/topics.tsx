import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HintSheet } from '../../../features/today/HintSheet';
import { useAddToQueue, useQueue, useRemoveQueueItem } from '../../../features/today/queue-queries';
import { deriveHintText } from '../../../features/today/rows';
import { QUEUE_PLATE_HEIGHT, QueuePlate } from '../../../features/topics/QueuePlate';
import { TopicFilterBar } from '../../../features/topics/TopicFilterBar';
import { TopicQueueRow } from '../../../features/topics/TopicRow';
import {
  READY_PARAM,
  filterFromParams,
  readyParamRequested,
  withReady,
  type TopicFilter,
} from '../../../features/topics/topic-filter';
import {
  deriveTopicRow,
  queueItemIdByTopic,
  showQueuePlate,
  type TopicRowView,
} from '../../../features/topics/topic-rows';
import { useTopics } from '../../../features/topics/use-topics';
import { strings } from '../../../strings';
import { colors, spacing, typeSizes } from '../../../theme/tokens';
import { NightBackground } from '../../../ui/NightBackground';
import { SecondaryButton } from '../../../ui/SecondaryButton';
import { SkeletonRows } from '../../../ui/SkeletonRows';
import { showToast } from '../../../ui/toast-store';
import { ToastHost } from '../../../ui/ToastHost';

// The screen «Темы» (design frame s-topics): the heading, the filter chips, the list of topics
// with a «+» / «✓» button on each and the plate «В очереди: N». A tab of the tabs navigator:
// the bottom bar belongs to the layout, and the screen stays mounted (with its filter and scroll
// position) while «Сегодня» is open; the list is read again each time the tab gains focus.
//
// A tap on «+» adds the topic to the end of the queue, a tap on «✓» takes it out again (with
// the toast «Убрали …»). Neither creates a story: no generation is spent here (AGENTS.md
// architecture rule 10). Only the round button acts; a tap on the row itself opens nothing.
// The field «Расскажи про…» of the design is not built yet.

const showErrorToast = (message: string) => showToast({ label: message });

// Distance from the bottom edge of the toast to the bottom bar in the design: 16 px (above the
// plate when the plate is shown).
const TOAST_GAP = 16;

export default function Topics() {
  const router = useRouter();
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ [READY_PARAM]?: string | string[] }>();
  // The filter starts from the route («готовые истории» on «Сегодня» opens it with «Только готовые»).
  const [filter, setFilter] = useState<TopicFilter>(() => filterFromParams(params[READY_PARAM]));
  const readyParam = params[READY_PARAM];
  // The screen is already mounted when «готовые истории» is tapped, so the parameter arrives
  // later: choose «Только готовые» and clear it. The effect sets a filter and a route parameter only;
  // it starts nothing and costs nothing (AGENTS.md architecture rule 10).
  useEffect(() => {
    if (!readyParamRequested(readyParam)) return;
    setFilter((current) => withReady(current, 'ready'));
    // The merge keeps the key with the value undefined, which the hook reports as absent.
    router.setParams({ [READY_PARAM]: undefined });
  }, [readyParam, router]);
  const [hintOpen, setHintOpen] = useState(false);

  const topics = useTopics(filter, { refetchOnFocus: true });
  const queue = useQueue();
  const queueItems = queue.data?.items;
  const queueCount = queueItems?.length ?? 0;

  const add = useAddToQueue({ onError: showErrorToast });
  const remove = useRemoveQueueItem({
    onError: showErrorToast,
    onRemoved: (title) =>
      showToast({ label: strings.today.toasts.removed, title, kind: 'remove' }),
  });
  const addMutate = add.mutate;
  const removeMutate = remove.mutate;

  const itemByTopic = useMemo(() => queueItemIdByTopic(queueItems ?? []), [queueItems]);
  const views = useMemo(
    () => (topics.data?.topics ?? []).map(deriveTopicRow),
    [topics.data],
  );

  const onToggle = useCallback(
    (view: TopicRowView) => {
      if (view.inQueue) {
        // ✓ takes the topic's queue item out. Without a known item (the queue has not loaded
        // yet) the tap does nothing; the next read of the queue settles it.
        const itemId = itemByTopic.get(view.id);
        if (itemId !== undefined) removeMutate(itemId);
      } else {
        addMutate([view.id]);
      }
    },
    [itemByTopic, addMutate, removeMutate],
  );
  const openHint = useCallback(() => setHintOpen(true), []);
  const closeHint = useCallback(() => setHintOpen(false), []);
  const openQueue = useCallback(() => router.navigate('/home'), [router]);

  const plateShown = showQueuePlate(queueCount);
  const listBottom = (plateShown ? QUEUE_PLATE_HEIGHT : 0) + spacing.lg;
  const toastOffset = (plateShown ? QUEUE_PLATE_HEIGHT : 0) + TOAST_GAP;

  const header = (
    <View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {strings.topics.title}
        </Text>
      </View>
      <View style={styles.filters}>
        <TopicFilterBar filter={filter} onChange={setFilter} />
      </View>
      <View style={styles.rule} />
    </View>
  );

  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        {topics.data === undefined && topics.isError ? (
          <View style={styles.plain}>
            {header}
            <View style={styles.failed}>
              <Text style={styles.failedTitle}>{strings.topics.errors.loadFailed}</Text>
              <Text style={styles.failedBody}>{strings.topics.errors.loadFailedBody}</Text>
              <SecondaryButton
                label={strings.topics.errors.retry}
                onPress={() => void topics.refetch()}
              />
            </View>
          </View>
        ) : topics.data === undefined ? (
          <View style={styles.plain}>
            {header}
            <View style={styles.skeletons}>
              <SkeletonRows count={6} numbered={false} />
            </View>
          </View>
        ) : (
          <FlatList
            data={views}
            keyExtractor={(view) => view.id}
            ListHeaderComponent={header}
            ListEmptyComponent={
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>{strings.topics.empty}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.rowWrap}>
                <TopicQueueRow view={item} onOpenHint={openHint} onToggle={onToggle} />
              </View>
            )}
            contentContainerStyle={{ paddingBottom: listBottom }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <QueuePlate count={queueCount} onOpenQueue={openQueue} />
      <HintSheet
        visible={hintOpen}
        onClose={closeHint}
        text={queue.data ? deriveHintText(queue.data.generations) : ''}
      />
      {focused ? <ToastHost bottomOffset={toastOffset} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  plain: { flex: 1 },
  skeletons: { marginHorizontal: spacing.xxl },
  heading: { paddingHorizontal: spacing.xxl },
  title: {
    marginTop: 24,
    color: colors.text,
    fontSize: typeSizes.display,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  filters: { marginTop: spacing.md },
  rule: {
    height: 1,
    marginTop: spacing.md,
    marginHorizontal: spacing.xxl,
    backgroundColor: colors.hairline,
  },
  rowWrap: { paddingHorizontal: spacing.xxl },
  emptyRow: {
    height: 56,
    marginHorizontal: spacing.xxl,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  emptyText: { color: colors.muted, fontSize: typeSizes.small },
  failed: { marginTop: 34, marginHorizontal: spacing.xxl, gap: 12 },
  failedTitle: { color: colors.text, fontSize: 21, fontWeight: '500' },
  failedBody: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22, marginBottom: 12 },
});

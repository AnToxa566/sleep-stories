import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../../ui/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInterests, useMe } from '../../../api/queries';
import { HintSheet } from '../../../features/today/HintSheet';
import { useAddToQueue, useQueue, useRemoveQueueItem } from '../../../features/today/queue-queries';
import { deriveHintText } from '../../../features/today/rows';
import { QUEUE_PLATE_HEIGHT, QueuePlate } from '../../../features/topics/QueuePlate';
import { SuggestEmpty, SuggestFooter } from '../../../features/topics/SuggestEntry';
import { SuggestSheet } from '../../../features/topics/SuggestSheet';
import { useTopicSuggestion } from '../../../features/topics/suggest-queries';
import {
  formatClock,
  hasChoice,
  initialSelection,
  sheetCaption,
  sheetOptions,
  toRequest,
  toggle,
  type SheetOptions,
  type SheetSelection,
} from '../../../features/topics/suggest-sheet';
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
//
// «Подобрать новые темы» (design frames 2e to 2e·7): «Ещё темы» in the heading, the block at
// the end of the list and the empty filter open one sheet. Its button starts one topic
// suggestion (a cheap model call, within the cap of 5 per 24 hours); it never creates a story
// (rule 10). While a suggestion runs, the three entries are inactive; its end shows a snackbar
// and the new topics appear at the top of the list.

const showErrorToast = (message: string) => showToast({ label: message });

const NO_OPTIONS: SheetOptions = { interests: [], styles: [] };
const NOTHING: SheetSelection = { interests: new Set(), styles: new Set() };

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selection, setSelection] = useState<SheetSelection>(NOTHING);

  const preferences = useMe().data?.preferences ?? null;
  const catalogue = useInterests().data?.interests;
  const options = useMemo(
    () =>
      preferences === null || catalogue === undefined
        ? NO_OPTIONS
        : sheetOptions(preferences, catalogue),
    [preferences, catalogue],
  );
  const onSuggestionFinished = useCallback((result: 'succeeded' | 'failed') => {
    const copy = strings.topics.suggest.toasts;
    showToast(
      result === 'succeeded'
        ? { label: copy.doneLabel, title: copy.doneTitle, kind: 'suggestDone' }
        : { label: '', title: copy.failedTitle, kind: 'suggestFailed' },
    );
  }, []);
  const onSuggestionStarted = useCallback(() => {
    const copy = strings.topics.suggest.toasts;
    showToast({ label: copy.startedLabel, title: copy.startedTitle, kind: 'suggestStarted' });
  }, []);
  const suggestion = useTopicSuggestion({
    onStarted: onSuggestionStarted,
    onFinished: onSuggestionFinished,
    onError: showErrorToast,
  });
  const { suggesting, start: startSuggestion } = suggestion;

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

  // Whichever entry opens it, the sheet ticks every interest and the style of the filter: only
  // that style while a style chip is on, every style under «Все» (owner, 2026-11-23).
  const openSheet = useCallback(() => {
    if (suggesting || options.styles.length === 0) return;
    setSelection(initialSelection(options, filter.style));
    setSheetOpen(true);
  }, [suggesting, options, filter.style]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const toggleInterest = useCallback(
    (key: string) => setSelection((current) => ({ ...current, interests: toggle(current.interests, key) })),
    [],
  );
  const toggleStyle = useCallback(
    (key: string) => setSelection((current) => ({ ...current, styles: toggle(current.styles, key) })),
    [],
  );
  // «Изменить»: the settings screen is not built yet, so the tab «Настройки» for now.
  const openSettings = useCallback(() => {
    setSheetOpen(false);
    router.navigate('/settings');
  }, [router]);
  const suggestions = suggestion.status?.suggestions;
  const canGo = suggestions !== undefined && suggestions.left > 0 && hasChoice(selection) && !suggesting;
  // The person's tap on «Подобрать темы», and only that, starts a suggestion.
  const go = useCallback(() => {
    if (!canGo) return;
    setSheetOpen(false);
    startSuggestion(toRequest(selection));
  }, [canGo, selection, startSuggestion]);
  const caption =
    suggestions === undefined ? '' : sheetCaption(selection, suggestions, formatClock);

  const plateShown = showQueuePlate(queueCount);
  const listBottom = (plateShown ? QUEUE_PLATE_HEIGHT : 0) + spacing.lg;
  const toastOffset = (plateShown ? QUEUE_PLATE_HEIGHT : 0) + TOAST_GAP;

  const header = (
    <View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {strings.topics.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.topics.suggest.headerButton}
          accessibilityState={{ disabled: suggesting }}
          disabled={suggesting}
          onPress={openSheet}
          style={({ pressed }) => [
            styles.more,
            suggesting && styles.inactive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.moreLabel}>{strings.topics.suggest.headerButton}</Text>
        </Pressable>
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
              <View style={styles.rowWrap}>
                <SuggestEmpty
                  suggesting={suggesting}
                  onOpen={openSheet}
                  styleFiltered={filter.style !== null}
                />
              </View>
            }
            ListFooterComponent={
              views.length > 0 ? (
                <View style={styles.rowWrap}>
                  <SuggestFooter suggesting={suggesting} onOpen={openSheet} />
                </View>
              ) : null
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
      <SuggestSheet
        visible={sheetOpen}
        onClose={closeSheet}
        options={options}
        selection={selection}
        onToggleInterest={toggleInterest}
        onToggleStyle={toggleStyle}
        onChangeSettings={openSettings}
        canGo={canGo}
        onGo={go}
        caption={caption}
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
  heading: {
    paddingHorizontal: spacing.xxl,
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  more: { height: 44, marginRight: -8, paddingHorizontal: 8, justifyContent: 'center' },
  moreLabel: { color: colors.accent, fontSize: typeSizes.body, fontWeight: '500' },
  inactive: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  title: {
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
  failed: { marginTop: 34, marginHorizontal: spacing.xxl, gap: 12 },
  failedTitle: { color: colors.text, fontSize: 21, fontWeight: '500' },
  failedBody: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22, marginBottom: 12 },
});

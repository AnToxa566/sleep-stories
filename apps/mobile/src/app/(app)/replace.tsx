import type { QueueItem } from '@sleep-stories/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HintSheet } from '../../features/today/HintSheet';
import { formatPosition } from '../../features/today/plural';
import { useQueue, useReplaceQueueItem } from '../../features/today/queue-queries';
import { deriveHintText, deriveRow } from '../../features/today/rows';
import { TopicFilterBar } from '../../features/topics/TopicFilterBar';
import { TopicSelectRow } from '../../features/topics/TopicRow';
import { DEFAULT_FILTER, type TopicFilter } from '../../features/topics/topic-filter';
import { deriveTopicRow, replaceCandidates } from '../../features/topics/topic-rows';
import { useTopics } from '../../features/topics/use-topics';
import { strings } from '../../strings';
import { colors, minTouchTarget, sizes, spacing, typeSizes } from '../../theme/tokens';
import { BackButton } from '../../ui/BackButton';
import { NightBackground } from '../../ui/NightBackground';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { SkeletonRows } from '../../ui/SkeletonRows';
import { showToast } from '../../ui/toast-store';
import { ToastHost } from '../../ui/ToastHost';

// The screen «Замена» (design frame s-replace): pick one topic to put in the place of a queue
// item. A stack screen above the tabs, so it has no bottom bar; the back button (and the
// Android back key) returns to «Сегодня».
//
// «Заменить» changes the topic of that one item and keeps its place. It creates no story and
// spends no generation (AGENTS.md architecture rule 10); it stays inactive until a topic is
// chosen. The field «Расскажи про…» of the design is not built yet.

const showErrorToast = (message: string) => showToast({ label: message });

// The bottom area holds the button: 56 px, 20 px above it, and the safe-area inset below.
const FOOTER_PADDING = spacing.xl;

export default function Replace() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ itemId?: string | string[] }>();
  const rawItemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const itemId = rawItemId !== undefined && rawItemId !== '' ? rawItemId : null;

  const [filter, setFilter] = useState<TopicFilter>(DEFAULT_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);

  const queue = useQueue();
  const topics = useTopics(filter);
  const replace = useReplaceQueueItem({
    onError: showErrorToast,
    onReplaced: (title) =>
      showToast({ label: strings.today.toasts.replaced, title, kind: 'replace' }),
  });
  const replaceMutate = replace.mutate;

  const items = queue.data?.items;
  const itemIndex = itemId !== null && items ? items.findIndex((item) => item.id === itemId) : -1;
  const item = items && itemIndex >= 0 ? items[itemIndex] : null;

  // Back to where the person came from; a cold start of this route has no history.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  // No item id, or the item is no longer in the queue (removed elsewhere, or a failed replace
  // found it gone and the queue was read again): there is nothing to replace, so go back.
  const left = useRef(false);
  useEffect(() => {
    if (left.current || items === undefined) return;
    if (itemId === null || !items.some((entry) => entry.id === itemId)) {
      left.current = true;
      leave();
    }
  }, [items, itemId, leave]);

  const candidates = useMemo(() => replaceCandidates(topics.data?.topics ?? []), [topics.data]);
  const views = useMemo(() => candidates.map(deriveTopicRow), [candidates]);
  // A choice hidden by another filter is not a choice: the button needs a visible selection.
  const selected = views.some((view) => view.id === selectedId) ? selectedId : null;

  const toggleSelect = useCallback(
    (id: string) => setSelectedId((current) => (current === id ? null : id)),
    [],
  );
  const openHint = useCallback(() => setHintOpen(true), []);
  const closeHint = useCallback(() => setHintOpen(false), []);

  const onConfirm = () => {
    if (itemId === null || selected === null || replace.isPending) return;
    replaceMutate({ itemId, topicId: selected }, { onSuccess: leave });
  };

  const footerHeight = sizes.buttonHeight + FOOTER_PADDING * 2 + insets.bottom;

  const header = (
    <View>
      {item ? <ReplacedCard position={formatPosition(itemIndex)} item={item} /> : null}
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
        <View style={styles.topBar}>
          <BackButton label={strings.common.back} onPress={leave} />
          <Text accessibilityRole="header" style={styles.topTitle}>
            {strings.replace.title}
          </Text>
          <View style={styles.topSpacer} />
        </View>
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
            extraData={selected}
            ListHeaderComponent={header}
            ListEmptyComponent={
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>{strings.topics.empty}</Text>
              </View>
            }
            renderItem={({ item: view }) => (
              <View style={styles.rowWrap}>
                <TopicSelectRow
                  view={view}
                  selected={view.id === selected}
                  onSelect={(picked) => toggleSelect(picked.id)}
                  onOpenHint={openHint}
                />
              </View>
            )}
            contentContainerStyle={{ paddingBottom: footerHeight + spacing.lg }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <View style={[styles.footer, { paddingBottom: FOOTER_PADDING + insets.bottom }]}>
        <PrimaryButton
          label={strings.replace.confirm}
          onPress={onConfirm}
          disabled={selected === null || item === null}
          loading={replace.isPending}
        />
      </View>
      <HintSheet
        visible={hintOpen}
        onClose={closeHint}
        text={queue.data ? deriveHintText(queue.data.generations) : ''}
      />
      <ToastHost bottomOffset={footerHeight + spacing.sm} />
    </View>
  );
}

type CardProps = {
  position: string;
  item: QueueItem;
};

// «Вместо»: the number, title and «Факты · 2:31» of the item being replaced.
function ReplacedCard({ position, item }: CardProps) {
  const row = deriveRow(item);
  return (
    <View style={styles.card}>
      <Text style={styles.cardNumber}>{position}</Text>
      <View style={styles.cardTexts}>
        <Text style={styles.cardEyebrow}>{strings.replace.instead}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {row.title}
        </Text>
        <Text style={styles.cardMeta}>{`${row.styleLabel} · ${row.statusText}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  plain: { flex: 1 },
  skeletons: { marginHorizontal: spacing.xxl },
  topBar: {
    height: 52,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: '500' },
  topSpacer: { width: minTouchTarget },
  card: {
    marginHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  cardNumber: {
    width: 28,
    color: colors.accent,
    fontSize: typeSizes.body,
    fontVariant: ['tabular-nums'],
  },
  cardTexts: { flex: 1, minWidth: 0, gap: 5 },
  cardEyebrow: {
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  cardTitle: { color: colors.textSoft, fontSize: 19, lineHeight: 25, fontWeight: '500' },
  cardMeta: { color: colors.muted, fontSize: typeSizes.small },
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
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: FOOTER_PADDING,
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.navBar,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});

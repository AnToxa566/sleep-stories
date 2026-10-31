import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInterests, useMe } from '../../api/queries';
import { EmptyQueue } from '../../features/today/EmptyQueue';
import { HintSheet } from '../../features/today/HintSheet';
import { ItemMenuSheet } from '../../features/today/ItemMenuSheet';
import { captionInterests } from '../../features/today/interest-caption';
import { deriveMainButton } from '../../features/today/main-button';
import { isNothingToCollect } from '../../features/today/queue-cache';
import { titleOf } from '../../features/today/queue-edit';
import {
  useAnotherStory,
  useCollectQueue,
  useGenerateAll,
  useGenerateOne,
  useQueue,
  useRemoveQueueItem,
  useReorderQueue,
} from '../../features/today/queue-queries';
import { QueueList } from '../../features/today/QueueList';
import { deriveHintText, deriveMenu, type MenuView } from '../../features/today/rows';
import { TodayMainButton } from '../../features/today/TodayMainButton';
import { useCollectingProgress } from '../../features/today/use-collecting-progress';
import { useCreatingProgress } from '../../features/today/use-creating-progress';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { BOTTOM_NAV_HEIGHT, BottomNav } from '../../ui/BottomNav';
import { Icon } from '../../ui/icons';
import { NightBackground } from '../../ui/NightBackground';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { showToast } from '../../ui/toast-store';
import { ToastHost } from '../../ui/ToastHost';

// The screen «Сегодня» (design frames 2a to 2a·14): greeting, the main button with its caption,
// the night queue (reorder by handle, swipe to remove, item menu), the empty states, toasts and
// the bottom bar.
//
// MONEY (AGENTS.md architecture rule 10): `generateAll` and `generateOne` are called only from
// press handlers below: the main button («Создать и начать»), «Создать сейчас» in the item menu
// and «Повторить» on a failed row. No effect, mount, poll or timer on this screen calls them.

const showErrorToast = (message: string) => showToast({ label: message });

type MenuSnapshot = { readonly itemId: string; readonly view: MenuView };

export default function Home() {
  const insets = useSafeAreaInsets();
  const queue = useQueue();
  const data = queue.data;
  const items = data?.items;

  // The server decides when the empty queue is being collected (`collecting` in the answer).
  const collecting = (data?.collecting ?? false) && (items?.length ?? 0) === 0;
  const progress = useCreatingProgress(items ?? []);
  const collectingProgress = useCollectingProgress(collecting);

  // «Три истории на темы: …» under the empty-state buttons: the person's own interests, shown
  // only once both the preferences and the catalogue have loaded and there is something to say.
  const me = useMe();
  const catalogue = useInterests();
  const preferences = me.data?.preferences ?? null;
  const catalogueInterests = catalogue.data?.interests;
  const emptyCaption = useMemo(() => {
    if (preferences === null || catalogueInterests === undefined) return null;
    const names = captionInterests(preferences, catalogueInterests);
    return names.length > 0 ? strings.today.empty.interestsCaption(names.join(', ')) : null;
  }, [preferences, catalogueInterests]);

  // The latest queue for press handlers, so their identity does not change with every poll.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const removeItem = useRemoveQueueItem({
    onError: showErrorToast,
    onRemoved: (title) =>
      showToast({ label: strings.today.toasts.removed, title, kind: 'remove' }),
  });
  const reorder = useReorderQueue({ onError: showErrorToast });
  const another = useAnotherStory({
    onError: showErrorToast,
    onReplaced: (title) =>
      showToast({ label: strings.today.toasts.replaced, title, kind: 'replace' }),
  });
  // «Собрать подборку»: asks for a topic suggestion; no story is generated. An empty answer
  // with nothing running means the pool and the daily suggestions are used up.
  const collect = useCollectQueue({
    onError: showErrorToast,
    onCollected: (response) => {
      if (isNothingToCollect(response)) showToast({ label: strings.today.errors.nothingToCollect });
    },
  });
  const collectMutate = collect.mutate;
  const generateAll = useGenerateAll({ onError: showErrorToast });
  const generateOne = useGenerateOne({ onError: showErrorToast });
  const generating = generateAll.isPending || generateOne.isPending;

  const removeMutate = removeItem.mutate;
  const reorderMutate = reorder.mutate;
  const anotherMutate = another.mutate;
  const generateAllMutate = generateAll.mutate;
  const generateOneMutate = generateOne.mutate;

  // The item menu. The snapshot keeps the sheet filled while it slides out, for example after
  // «Убрать» has already taken the item out of the queue.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSnapshot, setMenuSnapshot] = useState<MenuSnapshot | null>(null);
  const [hintOpen, setHintOpen] = useState(false);

  const openMenu = useCallback((itemId: string) => {
    const current = dataRef.current;
    if (current === undefined) return;
    const index = current.items.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    setMenuSnapshot({
      itemId,
      view: deriveMenu(current.items[index], index, current.generations),
    });
    setMenuOpen(true);
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openHint = useCallback(() => setHintOpen(true), []);
  const closeHint = useCallback(() => setHintOpen(false), []);

  const liveMenuIndex =
    menuSnapshot && items ? items.findIndex((item) => item.id === menuSnapshot.itemId) : -1;
  const menuView: MenuView | null =
    menuSnapshot && data && liveMenuIndex >= 0
      ? deriveMenu(data.items[liveMenuIndex], liveMenuIndex, data.generations)
      : (menuSnapshot?.view ?? null);

  // One explicit generation, started by a tap on «Повторить» or «Создать сейчас».
  const startOne = useCallback(
    (itemId: string) => {
      if (generating) return;
      const title = titleOf(dataRef.current?.items ?? [], itemId) ?? undefined;
      generateOneMutate(itemId, {
        onSuccess: () =>
          showToast({ label: strings.today.toasts.creating, title, kind: 'create' }),
      });
    },
    [generating, generateOneMutate],
  );
  const onCollectPress = useCallback(() => {
    if (collect.isPending) return;
    collectMutate();
  }, [collect.isPending, collectMutate]);
  const removeById = useCallback((itemId: string) => removeMutate(itemId), [removeMutate]);
  const reorderIds = useCallback((ids: string[]) => reorderMutate(ids), [reorderMutate]);

  const menuItemId = menuSnapshot?.itemId ?? null;
  const onMenuCreateNow = () => {
    setMenuOpen(false);
    if (menuItemId !== null) startOne(menuItemId);
  };
  const onMenuAnother = () => {
    setMenuOpen(false);
    if (menuItemId !== null) anotherMutate(menuItemId);
  };
  const onMenuRemove = () => {
    setMenuOpen(false);
    if (menuItemId !== null) removeMutate(menuItemId);
  };

  const mainView = data ? deriveMainButton(data.items, data.generations) : null;
  const onMainPress = () => {
    // «Начать» does nothing yet (playback is not built); only 'generate-all' costs money.
    if (mainView?.action !== 'generate-all' || generating) return;
    generateAllMutate(undefined, {
      onSuccess: () => showToast({ label: strings.today.toasts.creating, kind: 'create' }),
    });
  };

  const bottomInset = BOTTOM_NAV_HEIGHT + insets.bottom;
  const hasItems = (items?.length ?? 0) > 0;

  const header = (
    <View>
      <Greeting />
      {mainView ? (
        <TodayMainButton
          view={mainView}
          progress={progress}
          busy={generateAll.isPending}
          onPress={onMainPress}
        />
      ) : null}
      {hasItems ? <QueueTitle /> : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        {data ? (
          <QueueList
            items={data.items}
            header={header}
            empty={
              <EmptyQueue
                collecting={collecting}
                progress={collectingProgress}
                caption={emptyCaption}
                collectBusy={collect.isPending}
                onCollect={onCollectPress}
              />
            }
            footer={null}
            bottomPadding={bottomInset + spacing.lg}
            onReorder={reorderIds}
            onOpenMenu={openMenu}
            onOpenHint={openHint}
            onRetry={startOne}
            onRemove={removeById}
          />
        ) : (
          <View style={[styles.plain, { paddingBottom: bottomInset + spacing.lg }]}>
            <Greeting />
            {queue.isError ? (
              <LoadFailed onRetry={() => void queue.refetch()} />
            ) : (
              <ActivityIndicator color={colors.muted} style={styles.spinner} />
            )}
          </View>
        )}
      </SafeAreaView>
      <BottomNav />
      <ItemMenuSheet
        visible={menuOpen}
        onClose={closeMenu}
        menu={menuView}
        onCreateNow={onMenuCreateNow}
        onAnother={onMenuAnother}
        onRemove={onMenuRemove}
      />
      <HintSheet
        visible={hintOpen}
        onClose={closeHint}
        text={data ? deriveHintText(data.generations) : ''}
      />
      <ToastHost bottomOffset={bottomInset + 16} />
    </View>
  );
}

function Greeting() {
  return (
    <View>
      <Text style={styles.eyebrow}>{strings.today.greeting}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {strings.today.title}
      </Text>
    </View>
  );
}

// «Очередь на ночь» and «Добавить». Adding is not built (the topics screen), so the control is
// drawn dimmed and cannot be pressed, as the inactive tabs of the bottom bar are.
function QueueTitle() {
  return (
    <View style={styles.queueTitleWrap}>
      <View style={styles.queueTitle}>
        <Text style={styles.queueEyebrow}>{strings.today.queue.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.today.queue.add}
          accessibilityState={{ disabled: true }}
          disabled
          style={styles.add}
        >
          <Icon name="plus" size={16} color={colors.accent} />
          <Text style={styles.addLabel}>{strings.today.queue.add}</Text>
        </Pressable>
      </View>
      <View style={styles.rule} />
    </View>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.failed}>
      <Text style={styles.failedTitle}>{strings.today.errors.loadFailed}</Text>
      <Text style={styles.failedBody}>{strings.today.errors.loadFailedBody}</Text>
      <SecondaryButton label={strings.today.errors.retry} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  plain: { flex: 1, paddingHorizontal: spacing.xxl },
  spinner: { marginTop: spacing.huge },
  eyebrow: {
    marginTop: 34,
    color: colors.accent,
    fontSize: typeSizes.eyebrow,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  title: {
    marginTop: 14,
    color: colors.text,
    fontSize: typeSizes.display,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  queueTitleWrap: { marginTop: 34 },
  queueTitle: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queueEyebrow: {
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  add: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.45 },
  addLabel: { color: colors.textSoft, fontSize: typeSizes.small },
  rule: { height: 1, backgroundColor: colors.hairline },
  failed: { marginTop: 34, gap: 12 },
  failedTitle: { color: colors.text, fontSize: 21, fontWeight: '500' },
  failedBody: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22, marginBottom: 12 },
});

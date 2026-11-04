import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { strings } from '../../strings';
import { colors, minTouchTarget, spacing, typeSizes } from '../../theme/tokens';
import { HeardMark } from '../../ui/HeardMark';
import { Icon } from '../../ui/icons';
import type { TopicRowView } from './topic-rows';

// Height of a row in the designs (frames s-topics, s-replace).
export const TOPIC_ROW_HEIGHT = 68;

type BodyProps = {
  view: TopicRowView;
  // «Не готова» opens the hint sheet. Rows without a hint button ignore it.
  onOpenHint?: () => void;
};

// Title and the meta line: style, then the duration, «Не готова» (a button), «Создаётся · ~3 мин»
// or plain «Не удалось». A failed story is retried on «Сегодня» only: retrying spends a
// generation, and this list creates nothing (AGENTS.md rule 10).
function TopicRowBody({ view, onOpenHint }: BodyProps) {
  return (
    <View style={styles.texts}>
      <Text style={[styles.title, view.heard && styles.titleHeard]} numberOfLines={1}>
        {view.title}
      </Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{view.styleLabel}</Text>
        <Text style={styles.metaText}>·</Text>
        {view.durationText !== null ? <Text style={styles.metaText}>{view.durationText}</Text> : null}
        {view.hint ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.topics.row.notReady}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 16 }}
            onPress={onOpenHint}
            style={styles.hint}
          >
            <Icon name="circleDashed" size={13} color={colors.muted} />
            <Text style={styles.metaText}>{strings.topics.row.notReady}</Text>
          </Pressable>
        ) : null}
        {view.state === 'creating' ? (
          <>
            <Text style={styles.creating}>{view.statusLabel}</Text>
            <Text style={styles.metaText}>·</Text>
            <Text style={styles.metaText}>{view.statusDetail}</Text>
          </>
        ) : null}
        {view.state === 'failed' ? <Text style={styles.metaText}>{view.statusLabel}</Text> : null}
        {view.heard ? <HeardMark label={strings.topics.row.heard} /> : null}
      </View>
    </View>
  );
}

type QueueRowProps = BodyProps & {
  // «+» when false, «✓» when true. A press adds or removes; the screen decides which.
  onToggle: (view: TopicRowView) => void;
};

// A row of «Темы»: the body and a round «+» / «✓» button on the right. The button is the only
// press target that changes the queue.
export const TopicQueueRow = memo(function TopicQueueRow({
  view,
  onOpenHint,
  onToggle,
}: QueueRowProps) {
  const added = view.inQueue;
  return (
    <View style={styles.row}>
      <TopicRowBody view={view} onOpenHint={onOpenHint} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          added
            ? strings.topics.a11y.removeFromQueue(view.title)
            : strings.topics.a11y.addToQueue(view.title)
        }
        accessibilityState={{ checked: added }}
        onPress={() => onToggle(view)}
        style={[styles.round, added && styles.roundOn]}
      >
        <Icon name={added ? 'check' : 'plus'} size={17} color={added ? colors.accent : colors.textSoft} />
      </Pressable>
    </View>
  );
});

type SelectRowProps = BodyProps & {
  selected: boolean;
  onSelect: (view: TopicRowView) => void;
};

// A row of «Замена»: the whole row selects (single choice), a radio dot on the right.
export const TopicSelectRow = memo(function TopicSelectRow({
  view,
  selected,
  onSelect,
  onOpenHint,
}: SelectRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={strings.topics.a11y.selectTopic(view.title)}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(view)}
      style={styles.row}
    >
      <TopicRowBody view={view} onOpenHint={onOpenHint} />
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    height: TOPIC_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  texts: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: colors.text, fontSize: 17, fontWeight: '500' },
  // A heard story: the title is quieter, nothing is disabled.
  titleHeard: { color: colors.muted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 },
  metaText: { color: colors.muted, fontSize: typeSizes.small, fontVariant: ['tabular-nums'] },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  creating: { color: colors.textSoft, fontSize: typeSizes.small },
  round: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: { borderColor: colors.accentOutline, backgroundColor: colors.accentTint },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.radioBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  radioOn: { borderColor: colors.accentOutline },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});

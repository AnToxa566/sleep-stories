import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { strings } from '../../strings';
import { colors, spacing } from '../../theme/tokens';
import { Chip } from '../../ui/Chip';
import { FilterSheet } from './FilterSheet';
import {
  HEARD_OPTIONS,
  READY_OPTIONS,
  STYLE_CHIPS,
  heardChipLabel,
  readyChipLabel,
  withHeard,
  withReady,
  withStyle,
  type TopicFilter,
} from './topic-filter';

type Props = {
  filter: TopicFilter;
  onChange: (filter: TopicFilter) => void;
};

type OpenSheet = 'ready' | 'heard' | null;

// The chips under the heading of «Темы» and «Замена» (design frames s-topics, s-replace): one
// style or «Все», a thin divider, and the two filters «Готовность» and «Прослушивание». A
// filter chip opens a sheet with one choice; while a choice is on, the chip is highlighted and
// shows it. The row scrolls sideways on a narrow phone. The filter state lives in the screen;
// only the open sheet lives here.
export function TopicFilterBar({ filter, onChange }: Props) {
  const [open, setOpen] = useState<OpenSheet>(null);
  const close = () => setOpen(null);
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={strings.topics.a11y.filters}
        contentContainerStyle={styles.content}
        style={styles.scroll}
      >
        {STYLE_CHIPS.map((chip) => (
          <Chip
            key={chip.style ?? 'all'}
            label={chip.label}
            selected={filter.style === chip.style}
            onPress={() => onChange(withStyle(filter, chip.style))}
          />
        ))}
        <View style={styles.divider} />
        <Chip
          opensSheet
          label={readyChipLabel(filter.ready)}
          selected={filter.ready !== 'all'}
          onPress={() => setOpen('ready')}
        />
        <Chip
          opensSheet
          label={heardChipLabel(filter.heard)}
          selected={filter.heard !== 'all'}
          onPress={() => setOpen('heard')}
        />
      </ScrollView>
      <FilterSheet
        visible={open === 'ready'}
        onClose={close}
        title={strings.topics.filters.ready.title}
        options={READY_OPTIONS}
        value={filter.ready}
        onSelect={(ready) => onChange(withReady(filter, ready))}
      />
      <FilterSheet
        visible={open === 'heard'}
        onClose={close}
        title={strings.topics.filters.heard.title}
        options={HEARD_OPTIONS}
        value={filter.heard}
        onSelect={(heard) => onChange(withHeard(filter, heard))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xs,
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: spacing.xs,
    backgroundColor: colors.hairline,
  },
});

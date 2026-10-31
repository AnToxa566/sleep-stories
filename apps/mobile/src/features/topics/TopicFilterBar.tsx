import { ScrollView, StyleSheet, View } from 'react-native';
import { strings } from '../../strings';
import { colors, spacing } from '../../theme/tokens';
import { Chip } from '../../ui/Chip';
import { STYLE_CHIPS, toggleReady, withStyle, type TopicFilter } from './topic-filter';

type Props = {
  filter: TopicFilter;
  onChange: (filter: TopicFilter) => void;
};

// The chips under the heading of «Темы» and «Замена» (design frames s-topics, s-replace): one
// style or «Все», a thin divider, and «Готовые». It scrolls sideways on a narrow phone.
export function TopicFilterBar({ filter, onChange }: Props) {
  return (
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
        label={strings.topics.chips.ready}
        selected={filter.readyOnly}
        onPress={() => onChange(toggleReady(filter))}
      />
    </ScrollView>
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
  divider: { width: 1, height: 20, marginHorizontal: spacing.xs, backgroundColor: colors.hairline },
});

import { Pressable, StyleSheet, View } from 'react-native';
import { strings } from '../../../strings';
import { colors, typeSizes } from '../../../theme/tokens';
import { BottomSheet } from '../../../ui/layout/BottomSheet';
import { Chip } from '../../../ui/inputs/Chip';
import { Icon } from '../../../ui/icons/icons';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { Text } from '../../../ui/typography/typography';
import type { SheetChip, SheetOptions, SheetSelection } from './suggest-sheet';

type Props = {
  visible: boolean;
  onClose: () => void;
  options: SheetOptions;
  selection: SheetSelection;
  onToggleInterest: (key: string) => void;
  onToggleStyle: (key: string) => void;
  // «Изменить» next to a heading: the screen that edits that choice.
  onChangeInterests: () => void;
  onChangeStyles: () => void;
  canGo: boolean;
  onGo: () => void;
  caption: string;
};

// The sheet «Подобрать новые темы» (design frames 2e·2, 2e·3, 2e·7): the person's interests and
// styles as chips, «Изменить» next to each heading, the button and one caption under it. The
// state lives in the screen; this only draws it.
export function SuggestSheet({
  visible,
  onClose,
  options,
  selection,
  onToggleInterest,
  onToggleStyle,
  onChangeInterests,
  onChangeStyles,
  canGo,
  onGo,
  caption,
}: Props) {
  const copy = strings.topics.suggest;
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.sheetTitle}
          </Text>
          <Text style={styles.subtitle}>{copy.sheetBody}</Text>
        </View>
        <Group
          title={copy.interests}
          chips={options.interests}
          selected={selection.interests}
          onToggle={onToggleInterest}
          onChange={onChangeInterests}
          first
        />
        <Group
          title={copy.styles}
          chips={options.styles}
          selected={selection.styles}
          onToggle={onToggleStyle}
          onChange={onChangeStyles}
        />
        <View style={styles.action}>
          <PrimaryButton label={copy.go} onPress={onGo} disabled={!canGo} />
          <Text style={styles.caption}>{caption}</Text>
        </View>
      </View>
    </BottomSheet>
  );
}

function Group({
  title,
  chips,
  selected,
  onToggle,
  onChange,
  first = false,
}: {
  title: string;
  chips: readonly SheetChip[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onChange: () => void;
  first?: boolean;
}) {
  return (
    <View>
      <View style={[styles.groupHead, first ? styles.groupHeadFirst : null]}>
        <Text style={styles.eyebrow}>{title}</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${strings.topics.suggest.change}: ${title}`}
          onPress={onChange}
          hitSlop={8}
          style={({ pressed }) => [styles.change, pressed && styles.pressed]}
        >
          <Text style={styles.changeLabel}>{strings.topics.suggest.change}</Text>
          <Icon name="arrowRight" size={14} color={colors.accent} />
        </Pressable>
      </View>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            selected={selected.has(chip.key)}
            onPress={() => onToggle(chip.key)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 10 },
  heading: { gap: 6, paddingTop: 22, paddingBottom: 4 },
  title: { color: colors.text, fontSize: 21, fontWeight: '500' },
  subtitle: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22 },
  groupHead: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  groupHeadFirst: { marginTop: 20 },
  eyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  change: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32 },
  changeLabel: { color: colors.accent, fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  action: { marginTop: 28, gap: 12 },
  caption: {
    minHeight: 20,
    color: colors.muted,
    fontSize: typeSizes.caption,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});

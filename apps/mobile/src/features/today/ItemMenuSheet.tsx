import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typeSizes } from '../../theme/tokens';
import { BottomSheet } from '../../ui/BottomSheet';
import { Icon, type IconName } from '../../ui/icons';
import type { MenuEntry, MenuView } from './rows';

type Props = {
  visible: boolean;
  onClose: () => void;
  // Kept after the sheet closes so its content does not blank out during the slide.
  menu: MenuView | null;
  // «Создать сейчас»: starts ONE explicit generation (rule 10). A tap only.
  onCreateNow: () => void;
  onAnother: () => void;
  onRemove: () => void;
};

type EntryProps = {
  icon: IconName;
  entry: MenuEntry;
  onPress?: () => void;
  tone?: 'normal' | 'accent';
  chevron?: boolean;
};

function Entry({ icon, entry, onPress, tone = 'normal', chevron = false }: EntryProps) {
  const dim = !entry.enabled;
  const color = dim ? colors.placeholder : tone === 'accent' ? colors.accent : colors.textSoft;
  // «Создать сейчас · 1 из 3» keeps its detail on the right; the others under the label.
  const detailOnRight = chevron === false && icon === 'circleDashed' && entry.enabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.detail ? `${entry.label}, ${entry.detail}` : entry.label}
      accessibilityState={{ disabled: dim }}
      disabled={dim || onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <Icon name={icon} size={22} color={color} />
      <View style={styles.entryTexts}>
        <Text style={[styles.entryLabel, { color }]}>{entry.label}</Text>
        {entry.detail && !detailOnRight ? <Text style={styles.detail}>{entry.detail}</Text> : null}
      </View>
      {entry.detail && detailOnRight ? <Text style={styles.detail}>{entry.detail}</Text> : null}
      {chevron ? <Icon name="chevronRight" size={16} color={colors.muted} /> : null}
    </Pressable>
  );
}

// The menu of one queue item (design frame 2a·8): header with number, title and status, then
// «Создать сейчас» (only for items that need a generation), «Другая история», «Выбрать из
// тем» (inert: the topics screen is not built) and «Убрать».
export function ItemMenuSheet({ visible, onClose, menu, onCreateNow, onAnother, onRemove }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {menu ? (
        <View>
          <View style={styles.header}>
            <Text style={styles.position}>{menu.position}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {menu.title}
            </Text>
            <Text style={styles.meta}>{menu.meta}</Text>
          </View>
          {menu.createNow ? (
            <Entry icon="circleDashed" entry={menu.createNow} onPress={onCreateNow} />
          ) : null}
          <Entry icon="refresh" entry={menu.another} onPress={onAnother} />
          <Entry icon="compass" entry={menu.chooseFromTopics} chevron />
          <Entry icon="close" entry={menu.remove} onPress={onRemove} tone="accent" />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 5, paddingTop: 20, paddingBottom: 18 },
  position: {
    color: colors.accent,
    fontSize: typeSizes.eyebrow,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  title: { color: colors.text, fontSize: 19, fontWeight: '500' },
  meta: { color: colors.muted, fontSize: typeSizes.small },
  entry: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  pressed: { opacity: 0.7 },
  entryTexts: { flex: 1, gap: 4 },
  entryLabel: { fontSize: typeSizes.input },
  detail: { color: colors.muted, fontSize: typeSizes.small, fontVariant: ['tabular-nums'] },
});

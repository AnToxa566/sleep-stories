import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { strings } from '../../strings';
import { colors, typeSizes } from '../../theme/tokens';
import { BottomSheet } from '../../ui/BottomSheet';
import { Entry } from './ItemMenuSheet';

type Props = {
  visible: boolean;
  onClose: () => void;
  // «Добавить истории»: opens «Темы». Navigation only.
  onAdd: () => void;
  // «Пересобрать очередь»: replaces the queue (POST /queue/rebuild). A tap only (rule 10).
  onRebuild: () => void;
};

// The ⋯ menu of the queue header (design frame 2a·16): a sheet titled «Очередь на ночь» with
// «Добавить истории» and «Пересобрать очередь» (subtitle «Только непрослушанные истории»).
export function QueueMenuSheet({ visible, onClose, onAdd, onRebuild }: Props) {
  const copy = strings.today.queueMenu;
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Entry
          icon="plus"
          entry={{ label: copy.add, detail: null, enabled: true }}
          onPress={onAdd}
          chevron
        />
        <Entry
          icon="refresh"
          entry={{ label: copy.rebuild, detail: copy.rebuildHint, enabled: true }}
          onPress={onRebuild}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
    paddingTop: 22,
    paddingBottom: 14,
  },
});

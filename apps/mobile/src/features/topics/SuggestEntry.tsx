import { Pressable, StyleSheet, View } from 'react-native';
import { strings } from '../../strings';
import { colors, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { Text } from '../../ui/typography';

// Two of the three ways into «Подобрать новые темы» (the third is «Ещё темы» in the heading):
// the block at the end of the list (design frames 2e, 2e·4) and the empty filter (2e·1).

type Props = {
  // A suggestion runs: the entry is inactive.
  suggesting: boolean;
  onOpen: () => void;
};

// «Хотите ещё темы?» under the last topic. While a suggestion runs the button gives way to the
// inactive line «Подбираем темы…».
export function SuggestFooter({ suggesting, onOpen }: Props) {
  const copy = strings.topics.suggest;
  return (
    <View style={styles.footer}>
      <View style={styles.texts}>
        <Text style={styles.title}>{copy.footerTitle}</Text>
        <Text style={styles.body}>{copy.footerBody}</Text>
      </View>
      {suggesting ? (
        <View style={styles.pending} accessibilityRole="text">
          <Icon name="circleDashed" size={16} color={colors.muted} />
          <Text style={styles.pendingLabel}>{copy.footerPending}</Text>
        </View>
      ) : (
        <SecondaryButton label={copy.footerButton} onPress={onOpen} />
      )}
    </View>
  );
}

// The empty list. With a style filter on, the design's text promises topics «в этом стиле»;
// with no style chosen the list is simply empty, so the end-of-list text is used.
export function SuggestEmpty({
  suggesting,
  onOpen,
  styleFiltered,
}: Props & { styleFiltered: boolean }) {
  const copy = strings.topics.suggest;
  return (
    <View style={styles.empty}>
      <View style={styles.texts}>
        <Text style={styles.title}>{strings.topics.empty}</Text>
        <Text style={styles.body}>{styleFiltered ? copy.emptyBodyStyle : copy.footerBody}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.emptyButton}
        accessibilityState={{ disabled: suggesting }}
        disabled={suggesting}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.smallButton,
          suggesting && styles.inactive,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.smallLabel}>{copy.emptyButton}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 14, paddingTop: 32, paddingBottom: 8 },
  empty: { gap: 14, paddingTop: 28 },
  texts: { gap: 6 },
  title: { color: colors.text, fontSize: 17, fontWeight: '500' },
  body: { color: colors.muted, fontSize: typeSizes.small, lineHeight: 21 },
  pending: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pendingLabel: { color: colors.muted, fontSize: typeSizes.bodyLarge, fontWeight: '500' },
  smallButton: {
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.outline,
    justifyContent: 'center',
  },
  smallLabel: { color: colors.textSoft, fontSize: typeSizes.body, fontWeight: '500' },
  inactive: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});

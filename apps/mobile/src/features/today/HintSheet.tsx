import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { strings } from '../../strings';
import { colors, typeSizes } from '../../theme/tokens';
import { BottomSheet } from '../../ui/BottomSheet';
import { Icon } from '../../ui/icons';
import { SecondaryButton } from '../../ui/SecondaryButton';

type Props = {
  visible: boolean;
  onClose: () => void;
  // deriveHintText(generations), already worded.
  text: string;
};

// What a tap on «Не готова» opens (design frame 2a·6): why the story is not ready and what
// creating it costs. «Понятно» only closes it.
export function HintSheet({ visible, onClose, text }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <Icon name="circleDashed" size={28} color={colors.muted} />
        <Text style={styles.title}>{strings.today.hint.title}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
      <SecondaryButton label={strings.today.hint.dismiss} onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: 24, paddingBottom: 28 },
  title: { color: colors.text, fontSize: 21, fontWeight: '500' },
  text: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22 },
});

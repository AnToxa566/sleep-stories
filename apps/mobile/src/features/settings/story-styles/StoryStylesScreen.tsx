import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { strings } from '../../../strings';
import { colors, typeSizes } from '../../../theme/tokens';
import { StyleList } from '../../../ui/story-styles/StyleList';
import { Text } from '../../../ui/typography/typography';
import { SettingsEditScreen } from '../edit-screen/SettingsEditScreen';

type Props = ComponentProps<typeof StyleList> & {
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
};

// «Настройки → Стили» (design frame 4e). It only draws: the route decides what is ticked, and
// saves. The rows are the ones of onboarding, not the taller ones of the frame (owner). The
// caption is always shown, so the reason for an inactive button is on screen, and the save
// button ends the page, as on the other settings screens.
export function StoryStylesScreen({ canSave, saving, onSave, onBack, ...list }: Props) {
  const copy = strings.settings.stylesScreen;

  return (
    <SettingsEditScreen
      title={copy.title}
      subtitle={copy.subtitle}
      canSave={canSave}
      saving={saving}
      onSave={onSave}
      onBack={onBack}
    >
      <View style={styles.list}>
        <StyleList {...list} />
      </View>
      <Text style={styles.caption}>{copy.atLeastOne}</Text>
    </SettingsEditScreen>
  );
}

const styles = StyleSheet.create({
  // The line above the first row; each row draws the line under itself.
  list: { marginTop: 22, borderTopWidth: 1, borderTopColor: colors.hairline },
  caption: { marginTop: 18, color: colors.muted, fontSize: typeSizes.small, lineHeight: 20 },
});

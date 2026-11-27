import { StoryStyleSchema, type StoryStyle } from '@sleep-stories/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { styleCopy } from '../../strings';
import { colors, typeSizes } from '../../theme/tokens';
import { Icon } from '../icons/icons';
import { Text } from '../typography/typography';

type Props = {
  selected: readonly StoryStyle[];
  onToggle: (style: StoryStyle) => void;
};

// The story styles as rows with a checkbox, any number of them: onboarding and «Настройки →
// Стили». It draws the rows only, without a container: the space and the line above them are
// the caller's. Which set is allowed is the caller's rule too.
export function StyleList({ selected, onToggle }: Props) {
  return (
    <>
      {StoryStyleSchema.options.map((style) => {
        const checked = selected.includes(style);
        return (
          <Pressable
            key={style}
            accessibilityRole="checkbox"
            accessibilityLabel={`${styleCopy[style].label}, ${styleCopy[style].description}`}
            accessibilityState={{ checked }}
            onPress={() => onToggle(style)}
            style={styles.styleRow}
          >
            <View style={styles.styleTexts}>
              <Text style={styles.styleLabel}>
                {styleCopy[style].label}
              </Text>
              <Text style={styles.styleDescription}>{styleCopy[style].description}</Text>
            </View>
            <View style={[styles.box, checked && styles.boxOn]}>
              {checked ? <Icon name="check" size={14} color={colors.accent} /> : null}
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  styleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  styleTexts: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  styleLabel: { color: colors.text, fontSize: typeSizes.input, fontWeight: '500' },
  styleDescription: { color: colors.muted, fontSize: typeSizes.small },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.radioBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.accent },
});

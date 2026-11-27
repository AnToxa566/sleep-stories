import { CUSTOM_INTEREST_MAX_LENGTH, type Interest } from '@sleep-stories/contracts';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { SecondaryButton } from '../buttons/SecondaryButton';
import { Icon } from '../icons/icons';
import { Chip } from '../inputs/Chip';
import { Text, TextInput } from '../typography/typography';
import { displayCustomTitle } from './display-title';

type Props = {
  // Undefined until the catalogue has been read.
  catalogue: readonly Pick<Interest, 'slug' | 'title'>[] | undefined;
  // Wins over `catalogue`: after a failed read the error shows, even if an older list is left.
  loadFailed: boolean;
  onRetry: () => void;
  selectedSlugs: readonly string[];
  onToggleSlug: (slug: string) => void;
  // The topics the person typed, as stored; only their labels are capitalised.
  customChips: readonly { text: string; selected: boolean }[];
  onPressCustom: (text: string) => void;
  // Spoken hint of a typed chip: what a press does is up to the screen.
  customHint?: string;
  // True when the text was taken. Only then is the field cleared, so a rejected entry stays
  // visible.
  onSubmitText: (text: string) => boolean;
};

// The choice of interests: the catalogue chips and the typed ones in one wrap (design frame
// 4d), and the field for an own topic. It only draws and holds the text being typed: the
// screen reads the catalogue, keeps the selection and decides what a typed text becomes
// (`resolveInterestEntry`). The typed chips and the field stay while the catalogue is loading
// or has failed. It returns its blocks without a wrapper, so they lie directly in the page.
export function InterestPicker({
  catalogue,
  loadFailed,
  onRetry,
  selectedSlugs,
  onToggleSlug,
  customChips,
  onPressCustom,
  customHint,
  onSubmitText,
}: Props) {
  const copy = strings.interestPicker;
  const [text, setText] = useState('');
  const shownCatalogue = loadFailed ? undefined : catalogue;

  const submit = () => {
    if (onSubmitText(text)) setText('');
  };

  return (
    <>
      {loadFailed ? (
        <View style={styles.status}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {copy.loadFailed}
          </Text>
          <SecondaryButton label={strings.common.retry} onPress={onRetry} />
        </View>
      ) : catalogue === undefined ? (
        <View style={styles.status} accessibilityRole="progressbar">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.statusText}>{copy.loading}</Text>
        </View>
      ) : null}

      {shownCatalogue !== undefined || customChips.length > 0 ? (
        <View style={[styles.chips, shownCatalogue === undefined && styles.chipsAfterStatus]}>
          {/* The prefixes keep the keys apart: a typed text can equal a slug. */}
          {shownCatalogue?.map(({ slug, title }) => (
            <Chip
              key={`catalogue:${slug}`}
              label={title}
              selected={selectedSlugs.includes(slug)}
              onPress={() => onToggleSlug(slug)}
            />
          ))}
          {customChips.map((chip) => (
            <Chip
              key={`custom:${chip.text}`}
              label={displayCustomTitle(chip.text)}
              hint={customHint}
              selected={chip.selected}
              onPress={() => onPressCustom(chip.text)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.customRow}>
        <TextInput
          accessibilityLabel={copy.customPlaceholder}
          placeholder={copy.customPlaceholder}
          placeholderTextColor={colors.placeholder}
          selectionColor={colors.accent}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          maxLength={CUSTOM_INTEREST_MAX_LENGTH}
          returnKeyType="done"
          // Keeps the keyboard open so several topics can be typed in a row.
          submitBehavior="submit"
          style={styles.customInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.addCustomLabel}
          onPress={submit}
          style={styles.addButton}
        >
          <Icon name="plus" size={20} color={colors.accent} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xl },
  // Only typed chips, under the loading or error block: they sit closer to it.
  chipsAfterStatus: { marginTop: spacing.sm },
  status: { marginTop: spacing.xl, gap: spacing.lg, alignItems: 'flex-start' },
  statusText: { color: colors.muted, fontSize: typeSizes.body },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  customInput: {
    flex: 1,
    height: 46,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: typeSizes.input,
  },
  addButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

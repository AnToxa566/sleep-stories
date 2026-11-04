import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { colors } from '../../theme/tokens';
import { BottomSheet } from '../../ui/BottomSheet';
import { SelectRow } from '../../ui/SelectRow';

type Props<T extends string> = {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  value: T;
  // Called with the chosen value; the sheet closes itself afterwards (design: a choice closes it).
  onSelect: (value: T) => void;
};

// The sheet behind a filter chip of «Темы» and «Замена» (design frame s-topics-filter): a title
// and three rows with one choice. Choosing a row applies it and closes the sheet; choosing «Все»
// is how the filter is reset.
export function FilterSheet<T extends string>({
  visible,
  onClose,
  title,
  options,
  value,
  onSelect,
}: Props<T>) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {options.map((option) => (
          <SelectRow
            key={option.value}
            title={option.label}
            selected={option.value === value}
            onPress={() => {
              onSelect(option.value);
              onClose();
            }}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 8 },
  title: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '500',
    paddingTop: 22,
    paddingBottom: 14,
  },
});

import type { Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, sizes, spacing, typeSizes } from '../theme/tokens';

type Props = Omit<TextInputProps, 'style' | 'placeholderTextColor' | 'accessibilityLabel'> & {
  // Spoken label for screen readers. The designs show only the placeholder, so it is not drawn.
  label: string;
  error?: string | null;
  // Lets a form focus this field from another one (email "next" -> password).
  inputRef?: Ref<TextInput>;
};

// A hairline-underlined input. Everything else (secureTextEntry, keyboardType,
// textContentType, autoComplete, autoCapitalize, value, onChangeText...) passes through, so
// screens set the right autofill hints per field.
export function TextField({ label, error, inputRef, ...inputProps }: Props) {
  return (
    <View>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        selectionColor={colors.accent}
        {...inputProps}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: sizes.inputHeight,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: typeSizes.input,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  inputError: { borderBottomColor: colors.danger },
  error: {
    color: colors.danger,
    fontSize: typeSizes.caption,
    marginTop: spacing.sm,
  },
});

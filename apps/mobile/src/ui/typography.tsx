import type { Ref } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInput as NativeTextInputRef,
  type TextInputProps,
  type TextProps,
} from 'react-native';
import { fontFamilyForWeight } from '../theme/fonts';

// The app's `Text` and `TextInput`: the same as React Native's, set in Onest. Screens import
// these and never the raw ones (a spec scans for that). The weight is still written as
// `fontWeight` in styles; here it picks the matching Onest family and is then cleared, so
// Android does not fake a bold on top of the font file. A style that names its own
// `fontFamily` is left alone. A nested `Text` picks its family from its own weight (400 when it
// has none), so a nested span of a different weight sets `fontWeight` itself.

function withOnest(style: TextProps['style']): TextProps['style'] {
  const flat = StyleSheet.flatten(style);
  if (flat?.fontFamily) return style;
  return [style, { fontFamily: fontFamilyForWeight(flat?.fontWeight), fontWeight: 'normal' }];
}

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={withOnest(style)} />;
}

export function TextInput({
  style,
  ref,
  ...props
}: TextInputProps & { ref?: Ref<NativeTextInputRef> }) {
  return <NativeTextInput {...props} ref={ref} style={withOnest(style)} />;
}

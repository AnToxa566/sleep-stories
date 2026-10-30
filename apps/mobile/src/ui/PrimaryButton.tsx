import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radii, sizes, typeSizes } from '../theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

// The one primary action of a screen: a coral-to-rose gradient pill with dark text.
// The gradient is an SVG fill (no expo-linear-gradient). While loading the press is ignored.
export function PrimaryButton({ label, onPress, disabled = false, loading = false }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={StyleSheet.absoluteFill}>
        {disabled ? (
          <View style={[StyleSheet.absoluteFill, styles.disabledFill]} />
        ) : (
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="primaryFill" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.accent} />
                <Stop offset="1" stopColor={colors.accentEnd} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#primaryFill)" />
          </Svg>
        )}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: sizes.buttonHeight,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledFill: { backgroundColor: colors.disabledFill },
  pressed: { opacity: 0.85 },
  label: {
    color: colors.onAccent,
    fontSize: typeSizes.input,
    fontWeight: '500',
  },
  labelDisabled: { color: colors.disabledText },
});

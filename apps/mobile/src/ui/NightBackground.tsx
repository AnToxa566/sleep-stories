import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { colors } from '../theme/tokens';

// Two soft glows over the dark base: violet at the top edge, coral at the bottom edge.
// Drawn with SVG radial gradients so no extra gradient package is needed. Each glow is an
// ellipse whose own bounding box is the gradient's box, so it fades out at the ellipse edge.
export function NightBackground() {
  return (
    <View style={styles.fill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="glowTop" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.glowTop} stopOpacity={1} />
            <Stop offset="0.48" stopColor={colors.glowTop} stopOpacity={0.45} />
            <Stop offset="1" stopColor={colors.glowTop} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="glowBottom" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.glowBottom} stopOpacity={0.28} />
            <Stop offset="0.54" stopColor={colors.glowBottom} stopOpacity={0.1} />
            <Stop offset="1" stopColor={colors.glowBottom} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="50%" cy="-6%" rx="80%" ry="31%" fill="url(#glowTop)" />
        <Ellipse cx="50%" cy="106%" rx="78%" ry="27%" fill="url(#glowBottom)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.base,
  },
});

import { useState } from 'react';
import { Animated, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../../theme/tokens';

type Props = {
  // 0..1, the fake fill (progress.ts). Honest for reduce-motion too: it only follows the value.
  progress: Animated.Value;
  // A gradient id that is unique among the fills on screen.
  gradientId: string;
};

// The fill of an inactive «working…» button; put it first inside the button's rounded,
// overflow-hidden frame. It covers the frame, measures it, draws the gradient ONCE at the
// full measured size and slides it in from the left with a translateX.
//
// Why not a box that grows in width with an SVG inside: on the phone the SVG was drawn at the
// first, tiny width and never redrawn as the box grew, so the fill moved a couple of
// millimetres and stopped. Here the SVG never changes size; only a transform moves.
export function ProgressFill({ progress, gradientId }: Props) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) =>
      previous && previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );
  };
  return (
    <View pointerEvents="none" style={styles.clip} onLayout={onLayout}>
      {size ? (
        <Animated.View
          style={{
            width: size.width,
            height: size.height,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-size.width, 0],
                  extrapolate: 'clamp',
                }),
              },
            ],
          }}
        >
          <Svg width={size.width} height={size.height}>
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.accent} stopOpacity={0.16} />
                <Stop offset="1" stopColor={colors.accentEnd} stopOpacity={0.26} />
              </LinearGradient>
            </Defs>
            <Rect width={size.width} height={size.height} fill={`url(#${gradientId})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
});

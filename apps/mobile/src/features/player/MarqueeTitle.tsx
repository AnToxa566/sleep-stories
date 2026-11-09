import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme/tokens';
import { Text } from '../../ui/typography';
import { useReduceMotion } from '../../ui/use-reduce-motion';
import { MARQUEE_GAP, MARQUEE_HOLD_MS, marqueeGeometry } from './marquee-geometry';

// Design 3a: one line, 24 px. The line height is fixed so the block never changes height,
// whatever the title is: that is the point of the redesign.
const FONT_SIZE = 24;
const LINE_HEIGHT = 31;
// Wider than any title, so the measuring copy is never wrapped.
const MEASURE_WIDTH = 4000;

type Props = {
  text: string;
  // False while the screen is dimmed or asleep: the title stands still under the dimmed layer
  // instead of animating all night.
  active: boolean;
};

// The title of the playing story. A title that fits stands still. A longer one stands for 2.5 s,
// slides to the left at 32 px/s, and its own beginning follows it round the circle (design 3a).
// It runs on the UI thread (reanimated). With the system setting that removes animations, or
// while `active` is false, a long title stands still and ends in an ellipsis instead.
//
// The caller gives it a `key` of the story, so a new story starts from the beginning.
export function MarqueeTitle({ text, active }: Props) {
  const reduceMotion = useReduceMotion();
  const [boxWidth, setBoxWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const offset = useSharedValue(0);

  const geometry = marqueeGeometry(textWidth, boxWidth);
  const running = geometry.scrolls && active && !reduceMotion;

  useEffect(() => {
    if (!running) {
      cancelAnimation(offset);
      offset.value = 0;
      return;
    }
    // Stand still, then slide one round (the text and the gap); the repeat starts again from 0.
    offset.value = 0;
    offset.value = withRepeat(
      withDelay(
        MARQUEE_HOLD_MS,
        withTiming(-geometry.distance, { duration: geometry.moveMs, easing: Easing.linear }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(offset);
  }, [running, geometry.distance, geometry.moveMs, offset]);

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  const onBoxLayout = (event: LayoutChangeEvent) => setBoxWidth(event.nativeEvent.layout.width);
  const onTextLayout = (event: LayoutChangeEvent) => setTextWidth(event.nativeEvent.layout.width);

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={text}
      onLayout={onBoxLayout}
      style={styles.box}
    >
      {/* The title on one line without a limit, only to learn how wide it is. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.measure}
      >
        <Text onLayout={onTextLayout} style={styles.text}>
          {text}
        </Text>
      </View>
      {running ? (
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.track, trackStyle]}
        >
          <Text style={[styles.text, { width: textWidth + 1 }]}>{text}</Text>
          <Text style={[styles.text, { width: textWidth + 1, marginLeft: MARQUEE_GAP }]}>{text}</Text>
        </Animated.View>
      ) : (
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.text}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: LINE_HEIGHT, overflow: 'hidden', alignSelf: 'stretch' },
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: MEASURE_WIDTH,
    opacity: 0,
    flexDirection: 'row',
  },
  track: { position: 'absolute', left: 0, top: 0, flexDirection: 'row' },
  text: {
    color: colors.text,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontWeight: '500',
  },
});

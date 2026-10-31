import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '../theme/tokens';
import { strings } from '../strings';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
};

const OPEN_MS = 300;
const CLOSE_MS = 220;
// The sheet starts this far below its place; larger than any sheet this app draws.
const SLIDE_DISTANCE = 480;
// A downward drag past this share of the sheet's height closes it.
const CLOSE_FRACTION = 0.3;
// A downward fling faster than this (px/s) closes it whatever the distance.
const FLING_VELOCITY = 800;
// The pan starts after this many px downward, so a tap on a row in the sheet still reaches it.
const DRAG_ACTIVATION = 10;

// A bottom sheet on the core Modal: the dimming layer fades, the sheet slides up. Closes on a
// tap outside, on the Android back button and on a drag down (grabber or surface).
// One reanimated shared value (`translateY`: 0 open, SLIDE_DISTANCE closed) drives the open
// and close animations, the drag and the backdrop, so nothing fights over the same transform.
// A Modal is a separate native window on Android, so it needs its own GestureHandlerRootView.
// The content brings its own buttons; the sheet only supplies the surface, the grabber and
// the padding.
export function BottomSheet({ visible, onClose, children }: Props) {
  const translateY = useSharedValue(SLIDE_DISTANCE);
  const sheetHeight = useSharedValue(SLIDE_DISTANCE);
  // `visible` for the UI thread: a cancelled drag must not spring a closing sheet back open.
  const openSv = useSharedValue(visible);
  // The Modal stays mounted while the close animation plays.
  const [mounted, setMounted] = useState(visible);
  // The close animation ends on the UI thread; this is how the JS side checks, when the
  // callback lands, that the sheet was not opened again in the meantime.
  const visibleRef = useRef(visible);

  const onClosed = useCallback(() => {
    if (!visibleRef.current) setMounted(false);
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    openSv.value = visible;
    if (visible) {
      setMounted(true);
      translateY.value = withTiming(0, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    translateY.value = withTiming(
      SLIDE_DISTANCE,
      { duration: CLOSE_MS, easing: Easing.in(Easing.quad) },
      (finished) => {
        'worklet';
        // An interrupted close keeps the Modal mounted; a finished one asks the JS side first
        // (onClosed), because the sheet may have been opened again before the call lands.
        if (finished) scheduleOnRN(onClosed);
      },
    );
  }, [visible, translateY, onClosed, openSv]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        // Off while the sheet is closing: a drag then would spring it open with `visible` false.
        .enabled(visible)
        // Downward only; an upward or sideways move leaves the touch to the content.
        .activeOffsetY(DRAG_ACTIVATION)
        .onStart(() => {
          'worklet';
          cancelAnimation(translateY);
        })
        .onUpdate((event) => {
          'worklet';
          translateY.value = Math.max(0, event.translationY);
        })
        .onEnd((event, success) => {
          'worklet';
          const closes =
            success &&
            (translateY.value > sheetHeight.value * CLOSE_FRACTION ||
              event.velocityY > FLING_VELOCITY);
          if (closes) {
            // The parent turns `visible` off and the effect above plays the slide-out
            // from where the finger left the sheet.
            scheduleOnRN(onClose);
          } else if (openSv.value) {
            // Also reached when the drag is cancelled because the sheet is closing
            // (.enabled(false) cancels an active handler): then the close animation must win.
            translateY.value = withSpring(0, { damping: 24, stiffness: 280 });
          }
        }),
    [translateY, sheetHeight, onClose, visible, openSv],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, Math.max(sheetHeight.value, 1)], [1, 0], 'clamp'),
  }));

  const measure = (event: LayoutChangeEvent) => {
    sheetHeight.value = event.nativeEvent.layout.height;
  };

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.today.a11y.closeSheet}
            onPress={onClose}
            style={[StyleSheet.absoluteFill, styles.scrim]}
          />
        </Animated.View>
        <GestureDetector gesture={drag}>
          <Animated.View style={[styles.sheet, sheetStyle]} onLayout={measure}>
            <View style={styles.grabber} />
            {children}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    paddingTop: 10,
    paddingHorizontal: 24,
    paddingBottom: 34,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.grabber,
    alignSelf: 'center',
  },
});

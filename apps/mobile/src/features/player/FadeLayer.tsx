import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useReduceMotion } from '../../ui/use-reduce-motion';

type Props = {
  visible: boolean;
  // Fade durations in milliseconds. With reduce-motion on, both are 0 (a cut).
  inMs: number;
  outMs: number;
  // The fade in has finished (never called for a fade that was interrupted).
  onShown?: () => void;
  children: ReactNode;
};

// A layer drawn over its sibling content (absolute fill) that fades in and out by opacity with
// the native driver. The content under it is never touched, so nothing relayouts when the layer
// comes and goes. While the layer is hidden it is unmounted (its content, an orb with looping
// animations, then costs nothing) and while it fades out it passes touches through; only a layer
// that is meant to be visible takes them.
export function FadeLayer({ visible, inMs, outMs, onShown, children }: Props) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);
  const shown = useRef(onShown);
  shown.current = onShown;

  // Mount first, animate after: the animated view must exist before the animation starts.
  useEffect(() => {
    if (visible && !mounted) setMounted(true);
  }, [visible, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const animation = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? inMs : outMs,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (!finished) return;
      if (visible) shown.current?.();
      else setMounted(false);
    });
    return () => animation.stop();
  }, [visible, mounted, inMs, outMs, reduceMotion, opacity]);

  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { opacity }]}
    >
      {children}
    </Animated.View>
  );
}

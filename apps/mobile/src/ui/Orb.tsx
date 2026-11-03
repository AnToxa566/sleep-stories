import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Mask, Path, RadialGradient, Stop } from 'react-native-svg';
import {
  colourOpacity,
  conicWedges,
  hexToRgba,
  ORB_BREATH,
  orbLayout,
  type ConicStop,
} from './orb-geometry';
import { useReduceMotion } from './use-reduce-motion';

// The sleeping-mind orb from the designs (the intro mark; the player reuses it larger later).
// Four layers, as in the design: a soft glow, a spinning conic ring, a faint spinning sheen
// and a dark disc on top. All of it is vector (react-native-svg) and moves with the native
// Animated driver, so it needs no new library and works in Expo Go.
//
// The dark disc keeps a constant size. Only the coloured part (glow, ring, sheen) breathes:
// it grows and shrinks behind the disc and its glow and sheen drift in brightness. `dim`
// (design 3b) and `asleep` (3d) fade the coloured part out with a native opacity animation.
//
// Approximations against the web design, which uses CSS conic-gradient and blur():
// - the conic gradient is 90 thin wedges (see orb-geometry.ts);
// - blur is replaced by a radial fade mask (glow) and left out of the ring edge, which is
//   therefore a little crisper;
// - the sheen's `screen` blend becomes plain translucent lavender.
// A faithful blur would need Skia (planned for the player, not installed).

const RING_STOPS: ConicStop[] = ['#8F7CFF', '#FF8A6B', '#FF5E9A', '#5B6CFF', '#8F7CFF'].map(
  (hex, i, all) => ({ at: i / (all.length - 1), color: hexToRgba(hex) }),
);

// conic-gradient(from 90deg, transparent 0, 30% white at 40deg, transparent at 95deg and
// 200deg, 18% white at 245deg, transparent at 295deg), turned 90 degrees.
const SHEEN_STOPS: ConicStop[] = [
  { at: 0, color: hexToRgba('#F1ECFF', 0) },
  { at: 40 / 360, color: hexToRgba('#F1ECFF', 0.3) },
  { at: 95 / 360, color: hexToRgba('#F1ECFF', 0) },
  { at: 200 / 360, color: hexToRgba('#F1ECFF', 0) },
  { at: 245 / 360, color: hexToRgba('#F1ECFF', 0.18) },
  { at: 295 / 360, color: hexToRgba('#F1ECFF', 0) },
];

const WEDGES = 90;

type Props = {
  size: number;
  // The dimmed look (design 3b): the coloured part at low opacity, the disc unchanged.
  dim?: boolean;
  // The coloured part fully gone (design 3d). Wins over `dim`.
  asleep?: boolean;
  // Drawn centred on the disc (the countdown number of design 3c). When present the orb is
  // no longer hidden from screen readers, so the content can be read.
  children?: ReactNode;
};

const FADE_MS = 700;

export function Orb({ size, dim = false, asleep = false, children }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduceMotion = useReduceMotion();

  const ringTurn = useLoopingValue(24_000, reduceMotion);
  const sheenTurn = useLoopingValue(12_000, reduceMotion);
  const glowTurn = useLoopingValue(40_000, reduceMotion);
  // Applied to the coloured group only, never to the disc.
  const breathe = usePingPongValue(1, ORB_BREATH.scaleMax, ORB_BREATH.breatheMs, reduceMotion);
  const glowShimmer = usePingPongValue(
    ORB_BREATH.glowOpacity.min,
    ORB_BREATH.glowOpacity.max,
    ORB_BREATH.glowShimmerMs,
    reduceMotion,
  );
  const sheenShimmer = usePingPongValue(
    ORB_BREATH.sheenOpacity.min,
    ORB_BREATH.sheenOpacity.max,
    ORB_BREATH.sheenShimmerMs,
    reduceMotion,
  );
  const colourFade = useFadeValue(colourOpacity({ dim, asleep }), FADE_MS);

  const spin = (value: Animated.Value, reverse = false) => ({
    transform: [
      {
        rotate: value.interpolate({
          inputRange: [0, 1],
          outputRange: reverse ? ['0deg', '-360deg'] : ['0deg', '360deg'],
        }),
      },
    ],
  });

  const { glowSize, glowOffset, sheenSize, sheenOffset, discRadius } = orbLayout(size);
  const decorative = children === undefined || children === null;

  return (
    <View
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={{ width: size, height: size }}
    >
      {/* The coloured part: fades as a whole for dim and asleep, and breathes as a whole. */}
      <Animated.View style={[styles.layer, { width: size, height: size, opacity: colourFade }]}>
        <Animated.View style={[styles.layer, { width: size, height: size }, { transform: [{ scale: breathe }] }]}>
          {/* Glow: the ring colours spread beyond the orb, fading out. Spins the other way. */}
          <Animated.View
            style={[
              styles.layer,
              { width: glowSize, height: glowSize, left: glowOffset, top: glowOffset, opacity: glowShimmer },
              spin(glowTurn, true),
            ]}
          >
            <Svg width={glowSize} height={glowSize} viewBox={`0 0 ${glowSize} ${glowSize}`}>
              <Defs>
                {/* A mask reads brightness, not colour: lavender stands in for white, which the app never uses. */}
                <RadialGradient id={`${id}fade`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#F1ECFF" stopOpacity="1" />
                  <Stop offset="0.72" stopColor="#F1ECFF" stopOpacity="0.9" />
                  <Stop offset="1" stopColor="#F1ECFF" stopOpacity="0" />
                </RadialGradient>
                <Mask id={`${id}mask`} x="0" y="0" width={glowSize} height={glowSize}>
                  <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill={`url(#${id}fade)`} />
                </Mask>
              </Defs>
              <G mask={`url(#${id}mask)`}>
                {conicWedges({
                  stops: RING_STOPS,
                  count: WEDGES,
                  cx: glowSize / 2,
                  cy: glowSize / 2,
                  radius: glowSize / 2,
                  overlapDeg: 0.6,
                }).map((wedge, i) => (
                  <Path key={i} d={wedge.d} fill={wedge.fill} />
                ))}
              </G>
            </Svg>
          </Animated.View>

          {/* Ring: the conic gradient. Only its outer rim shows; the disc covers the middle. */}
          <Animated.View style={[styles.layer, { width: size, height: size }, spin(ringTurn)]}>
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {conicWedges({
                stops: RING_STOPS,
                count: WEDGES,
                cx: size / 2,
                cy: size / 2,
                radius: size / 2,
                overlapDeg: 0.6,
              }).map((wedge, i) => (
                <Path key={i} d={wedge.d} fill={wedge.fill} />
              ))}
            </Svg>
          </Animated.View>

          {/* Sheen: two soft light patches that drift around the rim. */}
          <Animated.View
            style={[
              styles.layer,
              { width: sheenSize, height: sheenSize, left: sheenOffset, top: sheenOffset, opacity: sheenShimmer },
              spin(sheenTurn),
            ]}
          >
            <Svg width={sheenSize} height={sheenSize} viewBox={`0 0 ${sheenSize} ${sheenSize}`}>
              {conicWedges({
                stops: SHEEN_STOPS,
                count: WEDGES,
                cx: sheenSize / 2,
                cy: sheenSize / 2,
                radius: sheenSize / 2,
                startDeg: 90,
              }).map((wedge, i) => (
                <Path key={i} d={wedge.d} fill={wedge.fill} />
              ))}
            </Svg>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* Dark disc with a violet glow just inside its edge. Constant size, does not spin. */}
      <View style={[styles.layer, { width: size, height: size }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <RadialGradient id={`${id}disc`} cx="50%" cy="38%" r="79.6%">
              <Stop offset="0" stopColor="#1A1230" />
              <Stop offset="0.62" stopColor="#0C0916" />
              <Stop offset="1" stopColor="#09070F" />
            </RadialGradient>
            <RadialGradient id={`${id}edge`} cx="50%" cy="50%" r="50%">
              <Stop offset="0.77" stopColor="#8F7CFF" stopOpacity="0" />
              <Stop offset="1" stopColor="#8F7CFF" stopOpacity="0.35" />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={discRadius} fill={`url(#${id}disc)`} />
          <Circle cx={size / 2} cy={size / 2} r={discRadius} fill={`url(#${id}edge)`} />
        </Svg>
      </View>

      {decorative ? null : <View style={[styles.layer, styles.content, { width: size, height: size }]}>{children}</View>}
    </View>
  );
}

// 0 to 1 forever, linear: one full turn per `durationMs`.
function useLoopingValue(durationMs: number, paused: boolean): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (paused) return;
    value.setValue(0);
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [value, durationMs, paused]);
  return value;
}

// `from` to `to` and back, forever, slowly and eased (breathing, shimmer).
function usePingPongValue(from: number, to: number, durationMs: number, paused: boolean): Animated.Value {
  const value = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    if (paused) return;
    const ease = Easing.inOut(Easing.ease);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: to, duration: durationMs, easing: ease, useNativeDriver: true }),
        Animated.timing(value, { toValue: from, duration: durationMs, easing: ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, from, to, durationMs, paused]);
  return value;
}

// Follows `target` with a smooth native opacity animation. Starts at the target (no fade on
// the first frame).
function useFadeValue(target: number, durationMs: number): Animated.Value {
  const value = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    const animation = Animated.timing(value, {
      toValue: target,
      duration: durationMs,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [value, target, durationMs]);
  return value;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0 },
  content: { alignItems: 'center', justifyContent: 'center' },
});

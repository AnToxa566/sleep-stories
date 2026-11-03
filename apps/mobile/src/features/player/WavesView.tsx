import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings } from '../../strings';
import { colors, spacing } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { NightBackground } from '../../ui/NightBackground';
import { Orb } from '../../ui/Orb';
import { PlayerHeader } from './PlayerHeader';
import { positionLabel, type PlayerState } from './player-machine';

type Props = {
  state: PlayerState;
  // Seconds left and the share already played, from native playback events.
  secondsLeft: number;
  progress: number;
  onLeave: () => void;
  // A touch anywhere on the screen: continue with more stories.
  onContinue: () => void;
};

const RING_RADIUS = 49;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const ORB_SIZE = 240;
const RING_SIZE = 300;

// «Вы спите?» (design 3c): the waves play, a ring and a number count down, and a touch anywhere
// continues the stories. The arrow is the one other control. While the request for more stories
// is in flight the hint turns into a calm «Ищем истории…».
export function WavesView({ state, secondsLeft, progress, onLeave, onContinue }: Props) {
  const { height } = useWindowDimensions();
  const scale = Math.min(1, height / 760);
  const orbSize = Math.round(ORB_SIZE * scale);
  const ringSize = Math.round(RING_SIZE * scale);
  const inset = (ringSize - orbSize) / 2;
  return (
    <View style={styles.root}>
      <NightBackground />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.player.a11y.continueStories}
        onPress={onContinue}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView pointerEvents="box-none" style={styles.safe}>
        <PlayerHeader label={positionLabel(state)} onLeave={onLeave} />
        <View pointerEvents="none" style={[styles.orbBox, { height: Math.round(380 * scale) }]}>
          <View style={{ width: orbSize, height: orbSize }}>
            <Svg
              width={ringSize}
              height={ringSize}
              viewBox="0 0 100 100"
              style={{ position: 'absolute', left: -inset, top: -inset, overflow: 'visible' }}
            >
              <G rotation={-90} origin="50, 50">
                <Circle
                  cx={50}
                  cy={50}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={colors.hairline}
                  strokeWidth={0.35}
                />
                <Circle
                  cx={50}
                  cy={50}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={colors.accent}
                  strokeOpacity={0.75}
                  strokeWidth={0.5}
                  strokeLinecap="round"
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * Math.min(1, Math.max(0, progress))}
                />
              </G>
            </Svg>
            <Orb size={orbSize}>
              <Text style={styles.number}>{secondsLeft}</Text>
            </Orb>
          </View>
        </View>
        <View pointerEvents="none" style={styles.texts}>
          <Text style={styles.title}>{strings.player.wavesTitle}</Text>
          <Text style={styles.body}>
            {state.continuing ? strings.player.continuing : strings.player.wavesBody}
          </Text>
        </View>
        <View pointerEvents="none" style={styles.footer}>
          {state.continuing ? null : (
            <View style={styles.tap}>
              <Icon name="touch" size={16} color={colors.muted} />
              <Text style={styles.tapLabel}>{strings.player.wavesTap}</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  orbBox: { marginTop: 20, alignItems: 'center', justifyContent: 'center' },
  number: {
    color: colors.textSoft,
    fontSize: 44,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
  },
  texts: { paddingHorizontal: spacing.huge, alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 29 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  footer: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40 },
  tap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tapLabel: { color: colors.muted, fontSize: 13 },
});

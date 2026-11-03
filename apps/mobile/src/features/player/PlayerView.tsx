import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings, styleCopy } from '../../strings';
import { colors, spacing } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { NightBackground } from '../../ui/NightBackground';
import { Orb } from '../../ui/Orb';
import { formatDuration } from '../today/plural';
import { PlayerHeader } from './PlayerHeader';
import { nextStoryIndex, positionLabel, type PlayerState } from './player-machine';
import type { PlayerStory } from './player-stories';

type Props = {
  state: PlayerState;
  stories: readonly PlayerStory[];
  positionSec: number;
  onLeave: () => void;
  onDim: () => void;
  onTogglePause: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

// The player (design 3a): header, the orb, the title with its style, the progress line, the
// three controls and the «Дальше» card. The card is shown only when the current story is not
// the last. Everything is the person's tap; nothing here starts a generation.
export function PlayerView({
  state,
  stories,
  positionSec,
  onLeave,
  onDim,
  onTogglePause,
  onPrevious,
  onNext,
}: Props) {
  const { height } = useWindowDimensions();
  const orbSize = Math.min(240, Math.round(height * 0.28));
  const story = stories[state.index];
  const nextIndex = nextStoryIndex(state);
  const next = nextIndex === null ? null : stories[nextIndex];
  if (story === undefined) return null;

  const total = story.durationSec;
  const fraction = total > 0 ? Math.min(1, Math.max(0, positionSec / total)) : 0;
  const elapsed = formatDuration(positionSec);
  const totalLabel = formatDuration(total);

  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView style={styles.safe}>
        <PlayerHeader label={positionLabel(state)} onLeave={onLeave} onDim={onDim} />
        <View style={[styles.orbBox, { height: orbSize + 60 }]}>
          <Orb size={orbSize} />
        </View>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>
            {story.title}
          </Text>
          <Text style={styles.style}>{styleCopy[story.style].label}</Text>
          <View
            accessible
            accessibilityLabel={strings.player.a11y.progress(elapsed, totalLabel)}
            style={styles.progressBlock}
          >
            <View style={styles.track}>
              <View style={[styles.fillBox, { width: `${Math.round(fraction * 1000) / 10}%` }]}>
                <Svg width="100%" height="100%" preserveAspectRatio="none">
                  <Defs>
                    <LinearGradient id="playerFill" x1="0" y1="0" x2="1" y2="0">
                      <Stop offset="0" stopColor={colors.accent} />
                      <Stop offset="1" stopColor={colors.accentEnd} />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#playerFill)" fillOpacity={0.8} />
                </Svg>
              </View>
            </View>
            <View style={styles.times}>
              <Text style={styles.time}>{elapsed}</Text>
              <Text style={styles.time}>{totalLabel}</Text>
            </View>
          </View>
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.player.a11y.previous}
              onPress={onPrevious}
              style={({ pressed }) => [styles.side, pressed && styles.pressed]}
            >
              <Icon name="skipPrevious" size={24} strokeWidth={1.5} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={state.paused ? strings.player.a11y.play : strings.player.a11y.pause}
              onPress={onTogglePause}
              style={({ pressed }) => [styles.main, pressed && styles.pressed]}
            >
              <Icon
                name={state.paused ? 'play' : 'pause'}
                size={26}
                color={colors.text}
                strokeWidth={1.5}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.player.a11y.next}
              onPress={onNext}
              style={({ pressed }) => [styles.side, pressed && styles.pressed]}
            >
              <Icon name="skipNext" size={24} strokeWidth={1.5} />
            </Pressable>
          </View>
        </View>
        {next === null || next === undefined ? (
          <View style={styles.spacer} />
        ) : (
          <View style={styles.nextWrap}>
            <View style={styles.nextCard}>
              <Text style={styles.nextEyebrow}>{strings.player.nextEyebrow}</Text>
              <Text numberOfLines={2} style={styles.nextTitle}>
                {next.title}
              </Text>
              <Text style={styles.nextMeta}>
                {strings.player.nextMeta(styleCopy[next.style].label, Math.round(next.durationSec / 60))}
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  orbBox: { alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.huge, alignItems: 'center' },
  title: { color: colors.text, fontSize: 29, lineHeight: 35, textAlign: 'center' },
  style: { marginTop: 8, color: colors.muted, fontSize: 15 },
  progressBlock: { alignSelf: 'stretch', marginTop: 30 },
  track: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.segmentOff,
    overflow: 'hidden',
  },
  fillBox: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  times: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  controls: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  side: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  main: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderColor: colors.playRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  spacer: { flex: 1 },
  nextWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 30 },
  nextCard: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingVertical: spacing.lg,
    gap: 5,
  },
  nextEyebrow: {
    color: colors.accent,
    fontSize: 11,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  nextTitle: { color: colors.textSoft, fontSize: 17, fontWeight: '500' },
  nextMeta: { color: colors.muted, fontSize: 14 },
});

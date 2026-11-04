import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../../ui/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings, styleCopy } from '../../strings';
import { colors, spacing } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { NightBackground } from '../../ui/NightBackground';
import { Orb } from '../../ui/Orb';
import { PlayerHeader } from './PlayerHeader';
import { nextStoryIndex, positionLabel, type PlayerState } from './player-machine';
import type { PlayerStory } from './player-stories';
import { SeekBar } from './SeekBar';

type Props = {
  state: PlayerState;
  stories: readonly PlayerStory[];
  // From the engine's view: position and length in seconds, and the share played (0 to 1).
  positionSec: number;
  durationSec: number;
  progress: number;
  onLeave: () => void;
  onDim: () => void;
  onTogglePause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  // The bar was dragged or tapped (seconds into the story), and any touch on it.
  onSeek: (seconds: number) => void;
  onActivity: () => void;
};

// The player (design 3a): header, the orb, the title with its style, the progress line, the
// three controls and the «Дальше» card. The card is shown only when the current story is not
// the last. Everything is the person's tap; nothing here starts a generation.
export function PlayerView({
  state,
  stories,
  positionSec,
  durationSec,
  progress,
  onLeave,
  onDim,
  onTogglePause,
  onPrevious,
  onNext,
  onSeek,
  onActivity,
}: Props) {
  const { height } = useWindowDimensions();
  const orbSize = Math.min(240, Math.round(height * 0.28));
  const story = stories[state.index];
  const nextIndex = nextStoryIndex(state);
  const next = nextIndex === null ? null : stories[nextIndex];
  if (story === undefined) return null;

  // The bar can be dragged while a story plays: not without a length and not in the pause after a
  // story (progress is exactly 1 then). A drag while the stream is still opening is harmless: the
  // engine ignores a seek it cannot make and the thumb goes back to `progress`.
  const seekable = durationSec > 0 && progress < 1;

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
          <SeekBar
            progress={progress}
            positionSec={positionSec}
            durationSec={durationSec}
            enabled={seekable}
            onSeek={onSeek}
            onActivity={onActivity}
          />
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.player.a11y.nextCard(next.title)}
              onPress={onNext}
              style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]}
            >
              <View style={styles.nextTexts}>
                <Text style={styles.nextEyebrow}>{strings.player.nextEyebrow}</Text>
                <Text numberOfLines={1} style={styles.nextTitle}>
                  {next.title}
                </Text>
                <Text style={styles.nextMeta}>
                  {strings.player.nextMeta(styleCopy[next.style].label, Math.round(next.durationSec / 60))}
                </Text>
              </View>
              <View style={styles.nextArrow}>
                <Icon name="chevronRight" size={18} strokeWidth={1.6} />
              </View>
            </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingVertical: spacing.lg,
  },
  nextTexts: { flex: 1, minWidth: 0, gap: 5 },
  nextArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
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

import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '../../ui/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings, styleCopy } from '../../strings';
import { colors, spacing } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { NightBackground } from '../../ui/NightBackground';
import { Orb } from '../../ui/Orb';
import { MarqueeTitle } from './MarqueeTitle';
import { PlayerHeader } from './PlayerHeader';
import { positionLabel, type PlayerState } from './player-machine';
import type { PlayerStory } from './player-stories';
import { SeekBar } from './SeekBar';

// The orb is at most this big (design 3a) and leaves this much room round it for its glow.
const ORB_MAX = 240;
const ORB_MARGIN = 24;

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
  // False while the screen is dimmed: the title then stops running (see MarqueeTitle).
  animateTitle: boolean;
};

// The player (design 3a, redesigned 2026-11-09): the header, the orb in the middle of the room
// that is left, and a block pinned to the bottom: the title (one line, running when it is long)
// and its style, the time bar and the three controls. The block has the same height for every
// story, so nothing moves when the story changes. There is no «Дальше» card: the next story is
// the next button. Everything is the person's tap; nothing here starts a generation.
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
  animateTitle,
}: Props) {
  // The orb takes the room between the header and the bottom block, up to its design size.
  const [orbRoom, setOrbRoom] = useState(0);
  const orbSize = Math.max(0, Math.min(ORB_MAX, Math.floor(orbRoom) - ORB_MARGIN));
  const story = stories[state.index];
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
        <View
          style={styles.orbBox}
          onLayout={(event: LayoutChangeEvent) => setOrbRoom(event.nativeEvent.layout.height)}
        >
          {orbSize > 0 ? <Orb size={orbSize} /> : null}
        </View>
        <View style={styles.body}>
          <MarqueeTitle key={state.index} text={story.title} active={animateTitle} />
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
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  orbBox: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.xxl, paddingBottom: 44, alignItems: 'stretch' },
  style: { marginTop: 4, color: colors.muted, fontSize: 15 },
  controls: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  side: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  main: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1.5,
    borderColor: colors.playRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});

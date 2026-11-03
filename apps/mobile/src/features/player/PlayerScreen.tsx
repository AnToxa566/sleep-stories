import { useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { strings } from '../../strings';
import { colors } from '../../theme/tokens';
import { AsleepView } from './AsleepView';
import { DimView } from './DimView';
import { FadeLayer } from './FadeLayer';
import type { NightEngine } from './night-engine';
import { PlayerView } from './PlayerView';
import { useIdleDim, useNightKeepAwake, useNightSession } from './use-night-session';
import { WavesView } from './WavesView';

// How the dimmed look (3b, and the dimmed waves) and the asleep screen (3d) fade in and out.
// In is slow so that the screen does not flash dark; out is quicker so that a touch is answered.
export const DIM_FADE_IN_MS = 600;
export const DIM_FADE_OUT_MS = 400;
export const ASLEEP_FADE_IN_MS = 1200;

// The stories player. The route (app/(app)/player.tsx) only renders this. The engine
// (night-engine.ts) holds the whole night; this component draws the look the state machine asks
// for and passes the person's touches to the engine.
export function PlayerScreen() {
  const engine = useNightSession();
  if (engine === null) return <View style={{ flex: 1, backgroundColor: colors.base }} />;
  return <PlayerBody engine={engine} />;
}

// One container, three layers. The underlay (the player view, or 3c during the waves) stays
// mounted whenever the screen dims: the dimmed look and the asleep screen are layers above it
// that fade by opacity, so nothing under them relayouts, remounts or restarts when they come and
// go. Before this the screen swapped separate component trees, and leaving the dimmed look
// mounted the player view again from scratch (see ARCHITECTURE.md section 7).
function PlayerBody({ engine }: { engine: NightEngine }) {
  const view = useSyncExternalStore(engine.subscribe, engine.getView);
  const { state } = view;
  const [asleepShown, setAsleepShown] = useState(false);
  // The screen stays on while the player is awake; the asleep screen lets it time out.
  useNightKeepAwake(state.mode !== 'asleep');
  const armIdle = useIdleDim(engine, state.mode === 'playing' && !state.paused);

  const asleep = state.mode === 'asleep';
  // Once the asleep screen has fully arrived it covers everything: the underlay and the dimmed
  // layer are then dropped (their orbs would only burn battery under an opaque page).
  const settled = asleep && asleepShown;
  const dimmed = state.mode === 'dim' || state.mode === 'waves-dim' || (asleep && !settled);
  const wavesUnder = state.mode === 'waves' || state.mode === 'waves-dim';

  return (
    <View style={{ flex: 1, backgroundColor: colors.base }}>
      {settled ? null : (
        <View
          style={{ flex: 1 }}
          // Only the player view counts a touch for the idle timer; the waves have their own.
          onTouchStart={state.mode === 'playing' ? armIdle : undefined}
          // A screen reader must not reach controls that the dimmed layer covers.
          accessibilityElementsHidden={dimmed}
          importantForAccessibility={dimmed ? 'no-hide-descendants' : 'auto'}
        >
          {wavesUnder ? (
            <WavesView
              state={state}
              secondsLeft={view.wavesLeftSec}
              progress={view.wavesProgress}
              onLeave={() => engine.leave()}
              onContinue={() => engine.touch()}
            />
          ) : (
            <PlayerView
              state={state}
              stories={view.stories}
              positionSec={view.positionSec}
              durationSec={view.durationSec}
              progress={view.progress}
              onLeave={() => engine.leave()}
              onDim={() => engine.moon()}
              onTogglePause={() => engine.togglePause()}
              onPrevious={() => engine.pressPrevious()}
              onNext={() => engine.pressNext()}
              onSeek={(seconds) => engine.seekTo(seconds)}
              onActivity={armIdle}
            />
          )}
        </View>
      )}
      {/* Dimmed during the stories or during the waves: a touch only leaves the dimmed look (to
          the player, or to 3c). Only a touch on 3c continues the stories. */}
      <FadeLayer visible={dimmed} inMs={DIM_FADE_IN_MS} outMs={DIM_FADE_OUT_MS}>
        <DimView onPress={() => engine.touch()} accessibilityLabel={strings.player.a11y.undim} />
      </FadeLayer>
      <FadeLayer
        visible={asleep}
        inMs={ASLEEP_FADE_IN_MS}
        outMs={DIM_FADE_OUT_MS}
        onShown={() => setAsleepShown(true)}
      >
        <AsleepView onPress={() => engine.touch()} />
      </FadeLayer>
    </View>
  );
}

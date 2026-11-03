import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { colors } from '../../theme/tokens';
import { AsleepView } from './AsleepView';
import { DimView } from './DimView';
import type { NightEngine } from './night-engine';
import { PlayerView } from './PlayerView';
import { strings } from '../../strings';
import { useIdleDim, useNightKeepAwake, useNightSession } from './use-night-session';
import { WavesView } from './WavesView';

// The stories player. The route (app/(app)/player.tsx) only renders this. The engine
// (night-engine.ts) holds the whole night; this component draws the look the state machine asks
// for and passes the person's touches to the engine.
export function PlayerScreen() {
  const engine = useNightSession();
  if (engine === null) return <View style={{ flex: 1, backgroundColor: colors.base }} />;
  return <PlayerBody engine={engine} />;
}

function PlayerBody({ engine }: { engine: NightEngine }) {
  const view = useSyncExternalStore(engine.subscribe, engine.getView);
  const { state } = view;
  // The screen stays on while the player is awake; the asleep screen lets it time out.
  useNightKeepAwake(state.mode !== 'asleep');
  const armIdle = useIdleDim(engine, state.mode === 'playing');

  switch (state.mode) {
    case 'playing':
      return (
        <View style={{ flex: 1 }} onTouchStart={armIdle}>
          <PlayerView
            state={state}
            stories={view.stories}
            positionSec={view.positionSec}
            onLeave={() => engine.leave()}
            onDim={() => engine.moon()}
            onTogglePause={() => engine.togglePause()}
            onPrevious={() => engine.pressPrevious()}
            onNext={() => engine.pressNext()}
          />
        </View>
      );
    // Dimmed during the stories or during the waves: a touch only leaves the dimmed look (to the
    // player, or to 3c). Only a touch on 3c continues the stories.
    case 'dim':
    case 'waves-dim':
      return <DimView onPress={() => engine.touch()} accessibilityLabel={strings.player.a11y.undim} />;
    case 'waves':
      return (
        <WavesView
          state={state}
          secondsLeft={view.wavesLeftSec}
          progress={view.wavesProgress}
          onLeave={() => engine.leave()}
          onContinue={() => engine.touch()}
        />
      );
    case 'asleep':
      return <AsleepView onPress={() => engine.touch()} />;
  }
}

import Slider from '@react-native-community/slider';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/typography';
import { strings } from '../../strings';
import { colors } from '../../theme/tokens';
import { formatDuration } from '../today/plural';
import {
  fractionAfterStep,
  fractionAtSliderValue,
  SEEK_STEP_SEC,
  SLIDER_STEPS,
  sliderValueAtFraction,
  THUMB_SIZE,
} from './player-seek';
import { secondsAtFraction } from './player-stories';

type Props = {
  // What the engine reports (NightView): the share played, the position and the length. While a
  // finger is down the bar shows its own position and ignores `progress` and `positionSec`.
  progress: number;
  positionSec: number;
  durationSec: number;
  // False while there is no length, in a pause between stories and anywhere but the playing
  // look: the engine ignores a seek then, so the bar does not take the touch.
  enabled: boolean;
  // Called once per gesture (on release, or for a tap) and for each screen-reader step.
  onSeek: (seconds: number) => void;
  // Any touch on the bar: it counts for the idle-dim timer like every other touch.
  onActivity: () => void;
};

// The time bar of design 3a on the native slider (@react-native-community/slider): the played
// part in the accent colour, the rest in the dim track colour, a 12 px thumb, two time labels
// under it. Lost against the design, because the native slider cannot draw them: the gradient
// fill, the glow of the thumb, the thumb growing while held, and the exact 2 px track (the
// platform draws its own track height).
//
// The slider is "controlled" by `progress` only while no finger is down. While the finger is
// down the library's own value drives the thumb and the elapsed label, and `value` is held at
// what it was when the finger went down: feeding progress into a native bar during a drag makes
// it jitter on Android. On release the bar seeks once and follows `progress` again.
export function SeekBar({ progress, positionSec, durationSec, enabled, onSeek, onActivity }: Props) {
  // The slider value (0 to SLIDER_STEPS) while a finger is down, otherwise null.
  const [drag, setDrag] = useState<number | null>(null);
  // True between sliding start and sliding complete, so a late value event cannot start a drag.
  const held = useRef(false);
  // The value sent to the native bar before the finger went down; it is not updated during a drag.
  const resting = useRef(0);

  const dragging = drag !== null;
  if (!dragging) resting.current = sliderValueAtFraction(progress);

  const fraction = dragging ? fractionAtSliderValue(drag) : Math.min(1, Math.max(0, progress));
  const elapsed = formatDuration(dragging ? secondsAtFraction(fraction, durationSec) : positionSec);
  const totalLabel = formatDuration(durationSec);
  const usable = enabled && durationSec > 0;

  const step = (deltaSec: number) => {
    if (!usable) return;
    onActivity();
    onSeek(secondsAtFraction(fractionAfterStep(progress, deltaSec, durationSec), durationSec));
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={strings.player.a11y.seek}
      accessibilityValue={{ text: strings.player.a11y.progress(elapsed, totalLabel) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') step(SEEK_STEP_SEC);
        else if (event.nativeEvent.actionName === 'decrement') step(-SEEK_STEP_SEC);
      }}
      style={styles.block}
    >
      <View style={styles.hit}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={SLIDER_STEPS}
          step={1}
          value={dragging ? resting.current : sliderValueAtFraction(progress)}
          disabled={!usable}
          // iOS only: a tap on the track moves the thumb there (Android does this natively).
          tapToSeek
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.segmentOff}
          thumbTintColor={colors.text}
          thumbSize={THUMB_SIZE}
          // The wrapper above is the one accessible element; its actions step by 10 s.
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          onSlidingStart={(value) => {
            held.current = true;
            onActivity();
            setDrag(value);
          }}
          onValueChange={(value) => {
            if (!held.current) return;
            onActivity();
            setDrag(value);
          }}
          onSlidingComplete={(value) => {
            held.current = false;
            onActivity();
            setDrag(null);
            if (durationSec > 0) onSeek(secondsAtFraction(fractionAtSliderValue(value), durationSec));
          }}
        />
      </View>
      <View pointerEvents="none" style={styles.times}>
        <Text style={styles.time}>{elapsed}</Text>
        <Text style={styles.time}>{totalLabel}</Text>
      </View>
    </View>
  );
}

// The touch area is 44 px high and reaches 21 px above and below the line without taking space
// (negative margins), as in the design.
const HIT_HEIGHT = 44;
const TRACK_TOP = 21;

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch', marginTop: 30 },
  hit: { height: HIT_HEIGHT, marginVertical: -TRACK_TOP, zIndex: 1 },
  slider: { alignSelf: 'stretch', height: HIT_HEIGHT },
  times: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
});

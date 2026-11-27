import { useFocusEffect } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import { initialSampleState, sampleReducer, tapIntent } from './voice-sample-state';

type SampleVoice = { slug: string; sampleUrl: string };

// Plays the voice samples on a screen with a voice list: one player for the screen, one sample
// at a time.
// - Tapping a voice starts it (the previous one stops); tapping the playing voice stops it, and
//   the next tap starts it from the beginning.
// - It stops when the screen loses focus (moving on to another screen included), on unmount and
//   when the app goes to the background. Sample playback is foreground only; background audio is a separate,
//   open decision (ARCHITECTURE.md section 11).
// - The player is released by `useAudioPlayer` on unmount.
// - The sample URL is signed and lives 10 minutes. A playback error calls `onPlaybackError`, where
//   the screen refetches the voices, so the next tap uses a fresh URL. The error text itself is
//   never shown or logged.
export function useVoiceSample(onPlaybackError: () => void) {
  // In a ref, so that a new function on every render does not resubscribe the player listener.
  const onPlaybackErrorRef = useRef(onPlaybackError);
  useEffect(() => {
    onPlaybackErrorRef.current = onPlaybackError;
  });
  // No source at first: every tap loads the URL of the tapped voice with `replace`.
  const player = useAudioPlayer();
  const [state, dispatch] = useReducer(sampleReducer, initialSampleState);

  // expo-audio's native default for playsInSilentMode is false on iOS (the docs say true), and a
  // person falling asleep to this app keeps the phone on silent. Set it once, explicitly.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    try {
      player.pause();
    } catch {
      // The player may already be released during unmount; there is nothing left to stop.
    }
    dispatch({ type: 'stop' });
  }, [player]);

  useEffect(() => {
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.error) {
        dispatch({ type: 'error' });
        onPlaybackErrorRef.current();
      } else if (status.didJustFinish) {
        dispatch({ type: 'finished' });
      }
    });
    return () => subscription.remove();
  }, [player]);

  useFocusEffect(useCallback(() => stop, [stop]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') stop();
    });
    return () => subscription.remove();
  }, [stop]);

  const toggle = useCallback(
    ({ slug, sampleUrl }: SampleVoice) => {
      if (tapIntent(state, slug) === 'stop') {
        stop();
        return;
      }
      try {
        player.replace({ uri: sampleUrl });
        player.play();
        dispatch({ type: 'start', slug });
      } catch {
        dispatch({ type: 'error' });
        onPlaybackErrorRef.current();
      }
    },
    [player, state, stop],
  );

  return { playingSlug: state.slug, failed: state.failed, toggle, stop };
}

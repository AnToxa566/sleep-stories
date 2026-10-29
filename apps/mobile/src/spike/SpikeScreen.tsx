import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';

import {
  NightController,
  watchAppState,
  type NightConfig,
  type NightState,
  type QueueEngine,
  type RecordingMode,
} from './audioController';
import { captureConsole, clearLog, getEntries, logFileUri, shareLog, subscribe } from './logger';

// Throwaway spike screen: plain dark layout, no design system, no strings module.

// Metering is on so RecorderState.metering is filled. Kept at module level so the hook does not
// recreate the recorder on every render.
const RECORDER_OPTIONS = { ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true };

const INITIAL_STATE: NightState = { phase: 'idle', detail: '', levelDb: null, ambientDb: null };

export function SpikeScreen() {
  const recorder = useAudioRecorder(RECORDER_OPTIONS);
  const [state, setState] = useState<NightState>(INITIAL_STATE);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('end');
  const [engine, setEngine] = useState<QueueEngine>('sequential');
  const [thresholdDb, setThresholdDb] = useState(12);
  const [minDurationMs, setMinDurationMs] = useState(300);
  const [windowSec, setWindowSec] = useState(20);
  const entries = useSyncExternalStore(subscribe, getEntries);
  const scrollRef = useRef<ScrollView>(null);

  const controller = useMemo(() => new NightController(recorder, setState), [recorder]);
  useEffect(() => {
    captureConsole();
    return watchAppState();
  }, []);

  const running = state.phase !== 'idle' && state.phase !== 'done';
  const config: NightConfig = { recordingMode, engine, thresholdDb, minDurationMs, windowSec };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Text style={styles.title}>Spike: фоновое аудио и «Вы спите?»</Text>

      <View style={styles.row}>
        <Choice<RecordingMode>
          label="Запись"
          value={recordingMode}
          options={[
            ['end', 'в конце ночи'],
            ['start', 'с начала ночи'],
          ]}
          onChange={setRecordingMode}
          disabled={running}
        />
      </View>
      <View style={styles.row}>
        <Choice<QueueEngine>
          label="Очередь"
          value={engine}
          options={[
            ['sequential', 'по плееру (экран блокировки)'],
            ['playlist', 'playlist (без экрана блокировки)'],
          ]}
          onChange={setEngine}
          disabled={running}
        />
      </View>
      <View style={styles.row}>
        <Stepper label="Порог, дБ" value={thresholdDb} step={1} min={3} max={40} onChange={setThresholdDb} disabled={running} />
        <Stepper label="Мин. длит., мс" value={minDurationMs} step={100} min={100} max={2000} onChange={setMinDurationMs} disabled={running} />
        <Stepper label="Окно, с" value={windowSec} step={5} min={5} max={60} onChange={setWindowSec} disabled={running} />
      </View>

      <View style={styles.row}>
        <Button label="Start night" primary disabled={running} onPress={() => void controller.start(config)} />
        <Button label="Stop" disabled={!running} onPress={() => void controller.stop()} />
      </View>

      <Text style={styles.status}>
        {state.phase}
        {state.detail ? ` — ${state.detail}` : ''}
      </Text>
      <Text style={styles.status}>
        level: {state.levelDb === null ? '–' : `${state.levelDb.toFixed(1)} dB`} · ambient:{' '}
        {state.ambientDb === null ? '–' : `${state.ambientDb.toFixed(1)} dB`}
      </Text>

      <View style={styles.row}>
        <Button label="Share log" onPress={() => void shareLog()} />
        <Button label="Clear log" disabled={running} onPress={clearLog} />
      </View>
      <Text style={styles.hint} numberOfLines={1}>
        {logFileUri()}
      </Text>

      <ScrollView
        ref={scrollRef}
        style={styles.log}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {entries.slice(-200).map((line, index) => (
          <Text key={`${index}-${line.length}`} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Button(props: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.button, props.primary && styles.buttonPrimary, props.disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.choice}>
      <Text style={styles.hint}>{props.label}</Text>
      <View style={styles.row}>
        {props.options.map(([value, label]) => (
          <Pressable
            key={value}
            disabled={props.disabled}
            onPress={() => props.onChange(value)}
            style={[styles.chip, props.value === value && styles.chipActive, props.disabled && styles.disabled]}
          >
            <Text style={styles.chipText}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Stepper(props: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const set = (next: number) => props.onChange(Math.min(props.max, Math.max(props.min, next)));
  return (
    <View style={[styles.stepper, props.disabled && styles.disabled]}>
      <Text style={styles.hint}>{props.label}</Text>
      <View style={styles.row}>
        <Pressable disabled={props.disabled} onPress={() => set(props.value - props.step)} style={styles.stepButton}>
          <Text style={styles.buttonText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{props.value}</Text>
        <Pressable disabled={props.disabled} onPress={() => set(props.value + props.step)} style={styles.stepButton}>
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const colors = {
  bg: '#0b0d14',
  panel: '#1a1f2e',
  panelActive: '#34406b',
  primary: '#3b4d99',
  text: '#cfd3e0',
  muted: '#8a90a6',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 56 : (StatusBar.currentHeight ?? 24) + 8,
    paddingBottom: 12,
    gap: 8,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  choice: { gap: 4 },
  button: { backgroundColor: colors.panel, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonText: { color: colors.text, fontSize: 15 },
  chip: { backgroundColor: colors.panel, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16 },
  chipActive: { backgroundColor: colors.panelActive },
  chipText: { color: colors.text, fontSize: 12 },
  stepper: { gap: 4 },
  stepButton: { backgroundColor: colors.panel, width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: colors.text, fontSize: 15, minWidth: 36, textAlign: 'center' },
  status: { color: colors.text, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 11 },
  disabled: { opacity: 0.4 },
  log: { flex: 1, backgroundColor: '#0f121c', borderRadius: 8, padding: 6 },
  logLine: {
    color: colors.text,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

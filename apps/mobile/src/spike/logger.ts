import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';

// The log is the instrument of this spike: every line goes to the on-screen list and is appended to a
// file in the document directory, so it survives until the phone is unlocked and can be shared.

export type LogTag =
  | 'APP'
  | 'MODE'
  | 'TRACK'
  | 'GAP'
  | 'REC'
  | 'METER'
  | 'DETECT'
  | 'HEARTBEAT'
  | 'TIMER'
  | 'ERR'
  | 'SUMMARY';

const MAX_ENTRIES = 400;
// Android cannot share a file through React Native's Share, so it shares the tail of the log as text.
const ANDROID_SHARE_LINES = 2000;

let entries: string[] = [];
let startedAt = Date.now();
const listeners = new Set<() => void>();
let fileError: string | null = null;

function logFile(): File {
  return new File(Paths.document, 'spike-log.txt');
}

function appendToFile(line: string) {
  try {
    const file = logFile();
    if (!file.exists) file.create();
    file.write(`${line}\n`, { append: true });
  } catch (e) {
    // Never throw from logging. Show once on screen that the file is not being written.
    const message = e instanceof Error ? e.message : String(e);
    if (fileError !== message) {
      fileError = message;
      entries = [...entries, `${new Date().toISOString()} [ERR] log file write failed: ${message}`];
    }
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

// Offset base for the "+ms" column. Reset at the start of every night.
export function markNightStart() {
  startedAt = Date.now();
}

export function log(tag: LogTag, message: string) {
  const now = Date.now();
  const line = `${new Date(now).toISOString()} +${now - startedAt}ms [${tag}] ${message}`;
  // New array every time: useSyncExternalStore compares snapshots by identity.
  entries = [...entries, line].slice(-MAX_ENTRIES);
  appendToFile(line);
  notify();
}

export function logError(context: string, e: unknown) {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  log('ERR', `${context}: ${message}`);
}

export function getEntries(): readonly string[] {
  return entries;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearLog() {
  entries = [];
  fileError = null;
  try {
    const file = logFile();
    if (file.exists) file.delete();
  } catch (e) {
    logError('clearLog', e);
  }
  notify();
}

export async function shareLog() {
  try {
    const file = logFile();
    if (!file.exists) {
      log('ERR', 'shareLog: no log file yet');
      return;
    }
    if (Platform.OS === 'ios') {
      await Share.share({ url: file.uri });
    } else {
      const lines = file.textSync().split('\n');
      const tail = lines.slice(-ANDROID_SHARE_LINES).join('\n');
      await Share.share({ message: tail, title: 'spike-log.txt' });
    }
  } catch (e) {
    logError('shareLog', e);
  }
}

export function logFileUri(): string {
  return logFile().uri;
}

// expo-audio reports some native failures only through console.error (for example "Failed to start the
// expo-audio foreground service for background recording": it is caught natively and record() still
// returns normally). Mirror console.error and console.warn into the log so those show up in it.
let consoleCaptured = false;
export function captureConsole() {
  if (consoleCaptured) return;
  consoleCaptured = true;
  const mirror = (level: 'error' | 'warn') => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const text = args
          .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)))
          .join(' ')
          .slice(0, 600);
        log('ERR', `console.${level}: ${text}`);
      } catch {
        // never let logging break the caller
      }
      original(...args);
    };
  };
  mirror('error');
  mirror('warn');
}

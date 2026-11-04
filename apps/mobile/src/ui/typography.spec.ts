import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Every screen sets its text in Onest through `ui/typography.tsx`. The raw `Text` and
// `TextInput` from React Native would draw the system font, and nothing else would notice.
// A text scan: a type-only import (`type TextInput`) is allowed.

const SRC_ROOT = join(__dirname, '..');
const WRAPPER = 'ui/typography.tsx';

function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const sources = listSources(SRC_ROOT).map((full) => ({
  path: relative(SRC_ROOT, full).split(sep).join('/'),
  text: readFileSync(full, 'utf8'),
}));

function importsRawText(text: string): boolean {
  for (const match of text.matchAll(/import \{([^}]*)\} from 'react-native';/g)) {
    const names = match[1].split(',').map((name) => name.trim());
    if (names.some((name) => name === 'Text' || name === 'TextInput')) return true;
  }
  return false;
}

describe('typography: text is set through the Onest wrappers', () => {
  it('scans the source tree (the scan is not empty)', () => {
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some((source) => source.path === WRAPPER)).toBe(true);
  });

  it('imports no raw Text or TextInput from react-native outside the wrapper', () => {
    const offenders = sources
      .filter((source) => source.path !== WRAPPER && importsRawText(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });

  it('the checker itself recognises a raw import and a type-only one', () => {
    expect(importsRawText("import { Pressable, Text } from 'react-native';")).toBe(true);
    expect(importsRawText("import { StyleSheet, type TextInput } from 'react-native';")).toBe(false);
  });
});

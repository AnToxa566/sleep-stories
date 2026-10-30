// Design tokens, read from the screen designs (design/, git-ignored, local only).
// The UI is dark-only and never uses pure white: the brightest colour here is the soft
// lavender `text`. tokens.spec.ts and no-white.spec.ts enforce it.

export const colors = {
  // Page background.
  base: '#09070F',
  // Soft glows drawn over the base by NightBackground.
  glowTop: '#2B1B6B',
  glowBottom: '#FF7078',
  // Text. `text` is the brightest colour in the app.
  text: '#F1ECFF',
  textSoft: '#E9E3FA',
  muted: '#A9A1D2',
  // Accent (eyebrow labels, selected state) and the primary button gradient.
  accent: '#FF9A7B',
  accentEnd: '#FF6F9C',
  // Text on the accent gradient.
  onAccent: '#1B0D1E',
  // Not in the designs, which show no errors: a soft rose, readable on the dark base.
  danger: '#FF8FA3',
  // Hairlines and outlines (lavender at low opacity).
  hairline: 'rgba(233,227,250,0.12)',
  outline: 'rgba(233,227,250,0.22)',
  outlineSoft: 'rgba(233,227,250,0.16)',
  radioBorder: 'rgba(233,227,250,0.3)',
  segmentOff: 'rgba(233,227,250,0.14)',
  toggleOff: 'rgba(233,227,250,0.16)',
  accentOutline: 'rgba(255,154,123,0.6)',
  accentTint: 'rgba(255,154,123,0.08)',
  // Placeholder text inside inputs.
  placeholder: 'rgba(169,161,210,0.7)',
  disabledFill: 'rgba(233,227,250,0.14)',
  disabledText: 'rgba(233,227,250,0.4)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  huge: 36,
} as const;

export const radii = {
  chip: 20,
  button: 28,
  buttonSmall: 26,
  pill: 999,
} as const;

// Every touch target is at least this tall and wide (platform guidance: 44).
export const minTouchTarget = 44;

// The system font is used on purpose: the designs draw Onest, which is not approved.
export const typeSizes = {
  eyebrow: 11,
  caption: 13,
  small: 14,
  body: 15,
  bodyLarge: 16,
  input: 17,
  title: 28,
  display: 30,
} as const;

export const sizes = {
  buttonHeight: 56,
  secondaryButtonHeight: 52,
  inputHeight: 50,
  chipHeight: 40,
  rowHeight: 76,
  segmentHeight: 2,
} as const;

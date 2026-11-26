import type { StoryStyle } from '@sleep-stories/contracts';

// The text that is actually sent to the TTS provider, composed at render time:
//
//   [storyteller]
//
//   История "Название".
//   [pause]
//   <story body>
//
// The stored `stories.text` stays clean (no tags, no intro); only the spoken text carries
// them. Trade-off: the tag syntax ([storyteller], [pause]) is ElevenLabs-specific and so
// belongs one layer above the adapter, yet it lives here in `generation/`. That buys a clean
// stored text and a single place to change the voicing; it costs a small coupling between
// `generation/` and the provider's dialect.

// A new story style fails typecheck here until it gets its kind word.
const KIND_WORDS: Record<StoryStyle, string> = {
  history: 'История',
  fairy_tale: 'Сказка',
  facts: 'Факт',
};

const OPENING_TAG = '[storyteller]';
const PAUSE_TAG = '[pause]';

// Square brackets, ASCII and fullwidth. One innermost span at a time, so that `[[x]]` is
// removed by the second pass of the loop. A span is at most 60 characters and cannot cross a
// newline: an audio tag is a short word, and a lone `[` early in a story plus a lone `]` far
// later must not delete the text between them (a rendered story cannot be redone without
// paying again). Bracket characters left over, if the span was longer, are removed by
// STRAY_BRACKET below, so no tag can survive either way: only a harmless word could be spoken.
const BRACKET_SPAN = /[[［][^[\]［］\n]{0,60}[\]］]/g;
const STRAY_BRACKET = /[[\]［］]/g;
const TITLE_QUOTES = /["«»“”„]/g;

// The title and the body are untrusted (AGENTS.md security rules 7 and 10): LLM output or a
// typed topic could carry audio tags such as [whispers] that the provider would obey. Every
// bracketed span is removed (not replaced), then any stray bracket. Our own tags are added
// only AFTER this, so they cannot be forged. Only spaces are collapsed: the body keeps its
// newlines.
function stripBrackets(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(BRACKET_SPAN, '');
    if (next === current) break;
    current = next;
  }
  return current.replace(STRAY_BRACKET, '').replace(/ {2,}/g, ' ');
}

// Returns the intro line, or undefined when nothing speakable is left of the title.
function composeIntro(style: StoryStyle, title: string): string | undefined {
  let cleaned = stripBrackets(title)
    .replace(/\s+/g, ' ')
    .replace(TITLE_QUOTES, '')
    .replace(/ {2,}/g, ' ')
    .trim();

  // A closing mark of the title stays inside the quotes and takes no full stop after it.
  let closed = /(\.\.\.|…|[?!])$/.test(cleaned);
  if (!closed) {
    cleaned = cleaned.replace(/[.,;:\s]+$/, '');
    closed = /[?!…]$/.test(cleaned);
  }
  // Nothing to read (empty, or only punctuation): no intro at all.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return undefined;

  return `${KIND_WORDS[style]} "${cleaned}"${closed ? '' : '.'}`;
}

export function composeSpokenText(input: {
  style: StoryStyle;
  title: string;
  body: string;
}): string {
  const body = stripBrackets(input.body).trim();
  const intro = composeIntro(input.style, input.title);
  if (intro === undefined) return `${OPENING_TAG}\n\n${body}`;
  return `${OPENING_TAG}\n\n${intro}\n${PAUSE_TAG}\n${body}`;
}

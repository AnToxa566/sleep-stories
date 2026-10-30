import { z } from 'zod';

// The ElevenLabs per-request limit (owner-verified 2026-10-30). A story is
// voiced in one request, so a longer text cannot be rendered.
export const STORY_TEXT_MAX_CHARS = 10_000;

// A floor so an empty reply or a short refusal is never voiced. It is not a
// quality check. The prompt asks for 3000 to 3500 characters, but the code
// deliberately does not check that range: it takes whatever the model returns
// up to the hard cap (owner decision).
export const STORY_TEXT_MIN_CHARS = 500;

// The LLM's story text: plain text, trimmed, within the bounds.
export const StoryTextSchema = z
  .string()
  .trim()
  .min(STORY_TEXT_MIN_CHARS)
  .max(STORY_TEXT_MAX_CHARS);

export type StoryText = z.infer<typeof StoryTextSchema>;

import { z } from 'zod';
import { SlugSchema } from './slug';

// One catalogue voice as served by GET /api/voices. Only what the client shows and sends back:
// the provider voice id, the TTS provider and the sample audio path stay on the server.
export const VoiceSchema = z.strictObject({
  slug: SlugSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
});

export const VoicesResponseSchema = z.strictObject({
  voices: z.array(VoiceSchema),
});

export type Voice = z.infer<typeof VoiceSchema>;
export type VoicesResponse = z.infer<typeof VoicesResponseSchema>;

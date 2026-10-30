import { z } from 'zod';
import { SlugSchema } from './slug';

// One catalogue voice as served by GET /api/voices. Only what the client shows and sends back:
// the provider voice id, the TTS provider and the stored sample audio path stay on the server.
// `sampleUrl` is a short-lived signed URL made per request from that path; the path itself is
// never sent, and the URL is never stored (ARCHITECTURE.md section 5, "Paths, not URLs").
export const VoiceSchema = z.strictObject({
  slug: SlugSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
  sampleUrl: z.url(),
});

export const VoicesResponseSchema = z.strictObject({
  voices: z.array(VoiceSchema),
});

export type Voice = z.infer<typeof VoiceSchema>;
export type VoicesResponse = z.infer<typeof VoicesResponseSchema>;

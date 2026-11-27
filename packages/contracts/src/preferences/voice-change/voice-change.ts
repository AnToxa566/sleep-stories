import { z } from 'zod';
import { SlugSchema } from '../../common/slug/slug';

// PUT /me/voice changes only the narrator. The answer is MeResponseSchema.
// strictObject: a body carrying `userId` or any other extra key is rejected.
// The user id comes only from the verified token, never from the body.
export const ChangeVoiceRequestSchema = z.strictObject({
  voiceSlug: SlugSchema,
});

export type ChangeVoiceRequest = z.infer<typeof ChangeVoiceRequestSchema>;

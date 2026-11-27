import { z } from 'zod';
import { StylesSchema } from '../../common/story-style/story-style';

// PUT /me/styles replaces the story styles of a person who finished onboarding. The answer is
// MeResponseSchema.
// strictObject: a body carrying `userId` or any other extra key is rejected.
// The user id comes only from the verified token, never from the body.
// StylesSchema is required, with no default: at least one style, none repeated.
export const ChangeStylesRequestSchema = z.strictObject({
  styles: StylesSchema,
});

export type ChangeStylesRequest = z.infer<typeof ChangeStylesRequestSchema>;

import { z } from 'zod';

// Lowercase ASCII words joined by single hyphens, for example "deep-space".
export const SlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type Slug = z.infer<typeof SlugSchema>;

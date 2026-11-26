import { z } from 'zod';
import { hasUniqueEntries } from '../unique/unique';

// Must match the Prisma enum StoryStyle in apps/api/prisma/schema.prisma.
// contracts cannot import the generated Prisma client, so the comparison test
// with the Prisma enum is added with the api seed.
export const StoryStyleSchema = z.enum(['facts', 'fairy_tale', 'history']);

export const StylesSchema = z
  .array(StoryStyleSchema)
  .min(1)
  .max(StoryStyleSchema.options.length)
  .refine(hasUniqueEntries, { error: 'Styles must be unique' });

export type StoryStyle = z.infer<typeof StoryStyleSchema>;

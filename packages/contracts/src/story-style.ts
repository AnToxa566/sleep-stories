import { z } from 'zod';

// Must match the Prisma enum StoryStyle in apps/api/prisma/schema.prisma.
// contracts cannot import the generated Prisma client, so the comparison test
// with the Prisma enum is added with the api seed.
export const StoryStyleSchema = z.enum(['facts', 'fairy_tale', 'history']);

export type StoryStyle = z.infer<typeof StoryStyleSchema>;

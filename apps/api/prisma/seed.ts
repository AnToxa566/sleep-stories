// Idempotent placeholder seed for voices and interests (a script, not a
// migration: migrations are schema only). Run it with `npx nx prisma-seed api`.
//
// It connects through DIRECT_URL, the same connection the Prisma CLI uses, and
// applies the same TLS rule as the API (DATABASE_TLS): verified TLS unless the
// explicit, fail-closed local switch is on. It prints counts only, never a URL.
//
// Re-running is safe: rows are upserted by slug. On UPDATE only display fields
// (name, description, title) and sort order are written. is_active is set only
// on create, and the provider fields of a voice are never touched, so a row an
// operator deactivated or a later real TTS configuration is not overwritten.
//
// A DIRECT_URL whose host is not loopback is refused unless SEED_ALLOW_REMOTE=yes.
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client';
import { addDatabaseTlsIssues, databaseTlsShape, postgresUrlSchema } from '../src/app/config/env';
import { resolveDatabaseSsl } from '../src/app/prisma/database-tls';
import { INTEREST_SEEDS, placeholderProviderFields, VOICE_SEEDS } from './seed-data';
import { decideSeedTarget } from './seed-target';

const seedEnvSchema = z
  .object({
    DIRECT_URL: postgresUrlSchema('DIRECT_URL'),
    ...databaseTlsShape,
  })
  .superRefine((env, ctx) => addDatabaseTlsIssues(env, env.DIRECT_URL, 'DIRECT_URL', ctx));

async function main(): Promise<void> {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // prettifyError prints messages and paths only, never values.
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;

  const target = decideSeedTarget({ url: env.DIRECT_URL, allowRemote: process.env.SEED_ALLOW_REMOTE });
  if (target.kind === 'refused') {
    throw new Error(
      'Invalid environment configuration:\nSeeding a database that is not on this machine requires SEED_ALLOW_REMOTE=yes',
    );
  }
  console.log(target.kind === 'local' ? 'Seeding a local database' : 'Seeding a REMOTE database');
  if (env.DATABASE_TLS === 'disabled-local-only') {
    console.log('Database TLS is disabled (plaintext, local development only)');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DIRECT_URL,
      ssl: resolveDatabaseSsl({ mode: env.DATABASE_TLS }),
      connectionTimeoutMillis: 10_000,
    }),
  });

  try {
    const voiceSlugs = Object.keys(VOICE_SEEDS) as (keyof typeof VOICE_SEEDS)[];
    for (const slug of voiceSlugs) {
      const { name, description, sortOrder } = VOICE_SEEDS[slug];
      await prisma.voice.upsert({
        where: { slug },
        create: { slug, name, description, sortOrder, isActive: true, ...placeholderProviderFields(slug) },
        // isActive only on create: a deactivated row stays deactivated, and
        // re-activating it is a manual step.
        update: { name, description, sortOrder },
      });
    }

    const interestSlugs = Object.keys(INTEREST_SEEDS) as (keyof typeof INTEREST_SEEDS)[];
    for (const slug of interestSlugs) {
      const { title, sortOrder } = INTEREST_SEEDS[slug];
      await prisma.interest.upsert({
        where: { slug },
        create: { slug, title, sortOrder, isActive: true },
        update: { title, sortOrder },
      });
    }

    const [voices, interests] = await Promise.all([prisma.voice.count(), prisma.interest.count()]);
    console.log(`Seed finished: ${voices} voices, ${interests} interests in the database.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Class and code only, like PrismaService; driver messages can contain the host or user name.
  const code = (error as { code?: unknown }).code;
  console.error(
    `Seed failed (${error instanceof Error ? error.name : 'Error'}${typeof code === 'string' ? `, ${code}` : ''})`,
  );
  if (error instanceof Error && error.message.startsWith('Invalid environment configuration')) {
    console.error(error.message);
  }
  process.exitCode = 1;
});

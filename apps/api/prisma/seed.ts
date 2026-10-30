// Idempotent seed for voices and interests (a script, not a migration: migrations
// are schema only). Run it with `npx nx prisma-seed api`.
//
// It connects through DIRECT_URL, the same connection the Prisma CLI uses, and
// applies the same TLS rule as the API (DATABASE_TLS): verified TLS unless the
// explicit, fail-closed local switch is on. It prints counts only, never a URL.
//
// Re-running is safe: rows are upserted by slug. On UPDATE only display fields
// (name, description, title), sort order and a voice's sample path are written. is_active is set only
// on create, and the provider fields of a voice are never overwritten, so a row an
// operator deactivated or a manual TTS configuration is not lost. One narrow,
// deliberate exception: a voice whose tts_provider is still the old placeholder
// 'none' (a row made by the first seed) gets the real provider and provider voice
// id. The update is guarded by tts_provider = 'none', so a manually configured row
// is skipped. Nothing else is written to an existing voice row. Voices are never
// deleted by the seed (foreign keys are RESTRICT).
//
// A DIRECT_URL whose host is not loopback is refused unless SEED_ALLOW_REMOTE=yes.
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client';
import { addDatabaseTlsIssues, databaseTlsShape, postgresUrlSchema } from '../src/app/config/env';
import { resolveDatabaseSsl } from '../src/app/prisma/database-tls';
import { INTEREST_SEEDS, sampleAudioPathFor, TTS_PROVIDER, VOICE_SEEDS } from './seed-data';
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
    let voicesConfigured = 0;
    for (const slug of voiceSlugs) {
      const { name, description, sortOrder, providerVoiceId } = VOICE_SEEDS[slug];
      await prisma.voice.upsert({
        where: { slug },
        create: {
          slug,
          name,
          description,
          sortOrder,
          isActive: true,
          ttsProvider: TTS_PROVIDER,
          providerVoiceId,
          sampleAudioPath: sampleAudioPathFor(slug),
        },
        // isActive and the provider fields only on create: a deactivated row stays
        // deactivated, and re-activating it is a manual step. The sample path is also
        // written on update: it is derived from the slug, so rows made when the path was a
        // placeholder (`sample.placeholder`) must be corrected, and the files are uploaded
        // by hand to exactly this path.
        update: { name, description, sortOrder, sampleAudioPath: sampleAudioPathFor(slug) },
      });
      // Fill only rows that are still the first seed's placeholder; never overwrite a manual configuration.
      const filled = await prisma.voice.updateMany({
        where: { slug, ttsProvider: 'none' },
        data: { ttsProvider: TTS_PROVIDER, providerVoiceId },
      });
      voicesConfigured += filled.count;
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

    const [activeVoices, inactiveVoices, interests] = await Promise.all([
      prisma.voice.count({ where: { isActive: true } }),
      prisma.voice.count({ where: { isActive: false } }),
      prisma.interest.count(),
    ]);
    console.log(
      `Seed finished: ${activeVoices} active and ${inactiveVoices} inactive voices, ${interests} interests in the database ` +
        `(this run: ${voicesConfigured} voices configured).`,
    );
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

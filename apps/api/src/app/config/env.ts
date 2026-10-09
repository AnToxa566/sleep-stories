import { resolve } from 'node:path';
import { z } from 'zod';

// Validated at boot by ConfigModule. A missing or malformed value crashes the
// process before the HTTP server starts, instead of failing at the first query.
// The messages below never include the offending value, because DATABASE_URL
// carries a password (SECURITY.md rule 1).
export const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL must not be empty')
    .refine((value) => /^postgres(ql)?:\/\//.test(value) && URL.canParse(value), {
      error: 'DATABASE_URL must be a postgres:// or postgresql:// connection URL',
    })
    .refine((value) => !URL.canParse(value) || !hasTlsParameter(new URL(value)), {
      error:
        'DATABASE_URL must not set TLS options (sslmode, ssl, sslrootcert and similar); TLS is configured in code',
    }),
});

// pg merges parameters from the connection string over the options passed in
// code, so `?sslmode=disable` in DATABASE_URL would silently turn off the
// verified TLS that PrismaService configures. Any ssl* parameter (sslmode, ssl,
// sslcert, sslkey, sslrootcert, sslnegotiation) and uselibpqcompat, which changes
// how sslmode is read, are therefore refused instead of being allowed to override it.
function hasTlsParameter(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const name = key.toLowerCase();
    if (name.startsWith('ssl') || name === 'uselibpqcompat') {
      return true;
    }
  }
  return false;
}

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

// Both the Prisma CLI and the running API read apps/api/.env.
// - Under Nx, every `api` task already has apps/api/.env injected into its
//   environment (serve, build and lint included), so these paths are not what
//   loads it there. ConfigModule does not override variables that are already set.
// - They matter when the built bundle runs outside Nx (`node dist/apps/api/main.js`):
//   apps/api/.env is found from the workspace root, and `.env` from apps/api.
// - The `.env` entry also means a `.env` in whatever directory the process starts
//   in is read. Only a workspace-root `.env` would be picked up by accident; none
//   exists today and `.env` is git-ignored.
// Variables already present in the process environment win.
export function envFilePaths(cwd: string = process.cwd()): string[] {
  return [resolve(cwd, 'apps/api/.env'), resolve(cwd, '.env')];
}

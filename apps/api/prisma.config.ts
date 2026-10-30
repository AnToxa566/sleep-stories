import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI (migrate, generate) connects through DIRECT_URL: the Supabase
// session pooler (port 5432), which supports the session-level features that
// migrations and the shadow database need. The running API uses DATABASE_URL
// (transaction pooler, port 6543) instead; see src/app/prisma/prisma.service.ts.
// Under Nx, apps/api/.env is already injected into every `api` task, so
// `dotenv/config` only matters when `prisma` is run directly from apps/api
// (for example `npx prisma validate`). It does not override variables already set.
//
// TLS: this connection is encrypted but the certificate is NOT verified (the
// schema engine accepts the Supabase chain that `sslaccept=strict` rejects). See
// ARCHITECTURE.md section 11. The runtime connection is verified in PrismaService.
//
// Seed: `prisma db seed` (the `prisma-seed` Nx target) runs prisma/seed.ts. In Prisma 7
// `migrate dev` no longer seeds on its own. The script is run by ts-node with
// tsconfig.config.json (CommonJS), the same setup that type-checks this file; it
// connects through DIRECT_URL with the TLS rule of PrismaService.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project tsconfig.config.json prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});

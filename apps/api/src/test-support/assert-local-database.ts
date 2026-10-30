import { isLoopbackDatabaseUrl, postgresUrlSchema } from '../app/config/env';

// Integration tests write to and delete from the real database, so they must
// never reach the cloud project. Refuses unless DATABASE_URL points at a loopback
// host. The message never contains the URL or the host.
// isLoopbackDatabaseUrl already refuses a `host` or `hostaddr` query parameter (pg
// lets either override the URL host). The URL must also pass postgresUrlSchema,
// which adds the scheme check and refuses ssl* parameters; kept as extra validation.
export function assertLocalDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const url = env['DATABASE_URL'];
  if (url === undefined || !postgresUrlSchema('DATABASE_URL').safeParse(url).success || !isLoopbackDatabaseUrl(url)) {
    throw new Error(
      'Integration tests refuse to run: DATABASE_URL must be set and point at a loopback host (the local Supabase stack). Start it with `npx nx supabase-start api`.',
    );
  }
}

import { isLoopbackDatabaseUrl } from '../src/app/config/env';

// Decides whether the seed may write to the database at `url`. Kept as a small
// pure function so it can be tested and so seed.ts stays thin.
//
// Seeding a database that is not on this machine must be a deliberate act: a
// stale DIRECT_URL left in the shell would otherwise write placeholder voices
// into the cloud project. It costs one extra variable for the rare real run.
// Neither the decision nor its labels contain the host or the URL.
export type SeedTarget = { kind: 'local' } | { kind: 'remote' } | { kind: 'refused' };

export function decideSeedTarget({
  url,
  allowRemote,
}: {
  url: string;
  allowRemote: string | undefined;
}): SeedTarget {
  if (isLoopbackDatabaseUrl(url)) {
    return { kind: 'local' };
  }
  return allowRemote === 'yes' ? { kind: 'remote' } : { kind: 'refused' };
}

import type { DatabaseTlsMode } from '../config/env';
import { SUPABASE_ROOT_CA } from './supabase-ca';

// Maps the validated DATABASE_TLS mode to the `ssl` option of the pg adapter.
// A pure function so that both PrismaService and the seed script use the same
// rule and it can be tested without a database.
//
// - 'verify': TLS verified against the pinned Supabase root CA, never
//   `rejectUnauthorized: false`.
// - 'disabled-local-only': no TLS. envSchema has already checked the loopback
//   host, the absence of Cloud Run variables and NODE_ENV; this function does
//   not re-check the environment, it only maps the mode.
// An unknown mode throws instead of falling through to either behaviour.
export function resolveDatabaseSsl({ mode }: { mode: DatabaseTlsMode }): { ca: string } | false {
  switch (mode) {
    case 'verify':
      return { ca: SUPABASE_ROOT_CA };
    case 'disabled-local-only':
      return false;
    default:
      throw new Error('Unknown DATABASE_TLS mode');
  }
}

import { resolve } from 'node:path';
import { z } from 'zod';

// Validated at boot by ConfigModule. A missing or malformed value crashes the
// process before the HTTP server starts, instead of failing at the first query.
// The messages below never include the offending value, because DATABASE_URL
// carries a password (SECURITY.md rule 1).

// A Postgres connection URL that cannot weaken the TLS that the code configures.
// Reused by the seed script for DIRECT_URL. `name` appears in the messages; the
// value never does.
export function postgresUrlSchema(name: string) {
  return z
    .string({ error: `${name} is required` })
    .min(1, `${name} must not be empty`)
    .refine((value) => /^postgres(ql)?:\/\//.test(value) && URL.canParse(value), {
      error: `${name} must be a postgres:// or postgresql:// connection URL`,
    })
    .refine((value) => !URL.canParse(value) || !hasTlsParameter(new URL(value)), {
      error: `${name} must not set TLS options (sslmode, ssl, sslrootcert and similar); TLS is configured in code`,
    })
    .refine((value) => !URL.canParse(value) || !hasHostOverrideParameter(new URL(value)), {
      error: `${name} must not set host or hostaddr as query parameters; use the URL host`,
    });
}

// How the API and the seed script secure the database connection.
// - verify: TLS with the pinned Supabase root CA. The default and the only
//   mode for the cloud project.
// - disabled-local-only: plaintext, for the local Supabase stack. Accepted only
//   when the checks in envSchema all pass (loopback host, not Cloud Run, not
//   production). It is an explicit opt-in so that a missing variable can never
//   turn TLS off: the default fails closed.
export const DATABASE_TLS_MODES = ['verify', 'disabled-local-only'] as const;
export type DatabaseTlsMode = (typeof DATABASE_TLS_MODES)[number];

// Variables that Cloud Run sets on services (K_SERVICE, K_REVISION,
// K_CONFIGURATION) and jobs (CLOUD_RUN_JOB). Any of them present, even empty,
// means "not a laptop".
const CLOUD_RUN_VARIABLES = ['K_SERVICE', 'K_REVISION', 'K_CONFIGURATION', 'CLOUD_RUN_JOB'] as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// True only when the URL parses, has no host or hostaddr query parameter, and its
// host is a loopback address. pg lets a `host` or `hostaddr` parameter override the
// URL host, so a URL that carries one is refused here, whatever its host says (see
// hasHostOverrideParameter). URL.hostname keeps the brackets of an IPv6 address
// ("[::1]"), WHATWG URL normalises every spelling of that address
// (`[0:0:0:0:0:0:0:1]` becomes `[::1]`), and for a non-special scheme such as
// postgresql:// the host is opaque and is not lower-cased, hence toLowerCase.
// Anything the parser does not reduce to one of the three names ("127.1",
// "localhost.", "0.0.0.0", a host after a second "@") is refused: fail closed
// rather than guess.
export function isLoopbackDatabaseUrl(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return !hasHostOverrideParameter(parsed) && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
}

// The variables that decide whether DATABASE_TLS=disabled-local-only is allowed.
// DATABASE_TLS is app configuration; the rest come from the raw process
// environment and are declared only so that a schema can see them (a z.object
// strips unknown keys before superRefine runs). Shared with the seed script, which
// must apply the same rule to DIRECT_URL.
const optionalString = z.string().optional();
export const databaseTlsShape = {
  DATABASE_TLS: z
    .enum(DATABASE_TLS_MODES, {
      error: `DATABASE_TLS must be one of: ${DATABASE_TLS_MODES.join(', ')}`,
    })
    .default('verify'),
  NODE_ENV: optionalString,
  K_SERVICE: optionalString,
  K_REVISION: optionalString,
  K_CONFIGURATION: optionalString,
  CLOUD_RUN_JOB: optionalString,
};

type DatabaseTlsInput = z.infer<z.ZodObject<typeof databaseTlsShape>>;

// Adds an issue for every condition that forbids a plaintext connection to the
// database at `url`. `urlName` appears in the messages; no value ever does.
export function addDatabaseTlsIssues(
  env: DatabaseTlsInput,
  url: string,
  urlName: string,
  ctx: z.RefinementCtx,
): void {
  if (env.DATABASE_TLS !== 'disabled-local-only') {
    return;
  }
  const fail = (message: string) => ctx.addIssue({ code: 'custom', path: ['DATABASE_TLS'], message });

  const loopback = isLoopbackDatabaseUrl(url);
  if (!loopback) {
    fail(`DATABASE_TLS=disabled-local-only requires the ${urlName} host to be 127.0.0.1, localhost or ::1`);
  }
  if (CLOUD_RUN_VARIABLES.some((name) => env[name] !== undefined)) {
    fail('DATABASE_TLS=disabled-local-only is not allowed on Cloud Run (a Cloud Run environment variable is set)');
  }
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    fail('DATABASE_TLS=disabled-local-only is not allowed when NODE_ENV is production');
  }
}

const PRIVATE_IPV4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

// SUPABASE_URL is where the API fetches the signing keys (JWKS) and what it expects
// as the token issuer, so a plaintext or spoofable URL would let an attacker
// supply their own keys. Rules, all value-free in their messages:
// - an origin only: no credentials, path, query or fragment;
// - https, except that http is accepted for a loopback host (the local Supabase
//   stack) and, only when DATABASE_TLS=disabled-local-only (already restricted to
//   a developer machine), for a private-network IPv4 literal.
// The token's `iss` is not taken from the address a client used: it comes from
// Supabase Auth's own configuration (its external URL). SUPABASE_URL must therefore
// equal the issuer base that Auth stamps into tokens, and a phone that reaches Auth
// through the Mac's LAN address does not force the API off 127.0.0.1. The
// private-network allowance exists only for the case that Auth's external URL itself
// is set to the LAN address, so that the issuer is that address.
// URL normalises numeric hosts for http, so "0300.0250.0.1" arrives as 192.168.0.1.
export function supabaseUrlProblem(value: string, tls: DatabaseTlsMode): string | null {
  if (!URL.canParse(value)) {
    return 'SUPABASE_URL must be a URL';
  }
  const url = new URL(value);
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    return 'SUPABASE_URL must be an origin only (scheme, host and optional port; no credentials, path, query or fragment)';
  }
  if (url.protocol === 'https:') {
    return null;
  }
  if (url.protocol !== 'http:') {
    return 'SUPABASE_URL must use https';
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return null;
  }
  if (tls === 'disabled-local-only' && PRIVATE_IPV4.test(url.hostname)) {
    return null;
  }
  return 'SUPABASE_URL must use https unless it is a loopback address (or, with DATABASE_TLS=disabled-local-only, a private-network IPv4 address)';
}

export const envSchema = z
  .object({
    DATABASE_URL: postgresUrlSchema('DATABASE_URL'),
    SUPABASE_URL: z.string({ error: 'SUPABASE_URL is required' }).min(1, 'SUPABASE_URL must not be empty'),
    ...databaseTlsShape,
  })
  .superRefine((env, ctx) => {
    addDatabaseTlsIssues(env, env.DATABASE_URL, 'DATABASE_URL', ctx);
    const problem = supabaseUrlProblem(env.SUPABASE_URL, env.DATABASE_TLS);
    if (problem !== null) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: problem });
    }
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

// pg-connection-string also lets a `host` query parameter win over the URL host
// (checked in pg-connection-string 2.14.1), and `hostaddr` likewise. Without this
// refusal, `postgresql://u:p@127.0.0.1/db?host=db.example.com` would pass the
// loopback check of DATABASE_TLS=disabled-local-only and still connect to a remote
// host in plaintext. isLoopbackDatabaseUrl applies it too, so a URL with such a
// parameter is never "loopback". URLSearchParams decodes percent-encoded names, so
// `%68ost=` is caught as well.
function hasHostOverrideParameter(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const name = key.toLowerCase();
    if (name === 'host' || name === 'hostaddr') {
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

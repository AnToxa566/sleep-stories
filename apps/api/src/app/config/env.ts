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

// True on Cloud Run or when NODE_ENV is production (trimmed, case-insensitive). The
// shared test for every setting that must never exist outside a developer machine.
function isCloudRunOrProduction(env: {
  NODE_ENV?: string | undefined;
  K_SERVICE?: string | undefined;
  K_REVISION?: string | undefined;
  K_CONFIGURATION?: string | undefined;
  CLOUD_RUN_JOB?: string | undefined;
}): boolean {
  return (
    CLOUD_RUN_VARIABLES.some((name) => env[name] !== undefined) ||
    env.NODE_ENV?.trim().toLowerCase() === 'production'
  );
}

// How a generation job reaches the runner (ARCHITECTURE.md section 6, "How jobs run").
// - none: nothing is dispatched. The default, so a missing variable never starts
//   paid work; a job stays pending until a sweep or a later run picks it up.
// - local: the API posts to its own /internal endpoint with a per-boot secret.
//   Development only.
// - cloud-tasks: the production path. Accepted here; the module bootstrap refuses it
//   until it is implemented.
// `none` and `local` are refused on Cloud Run and in production: a silent no-op queue
// there would lose every job, and the local credential must not exist there.
export const JOB_QUEUE_MODES = ['none', 'local', 'cloud-tasks'] as const;
export type JobQueueMode = (typeof JOB_QUEUE_MODES)[number];

// INTERNAL_OIDC_AUDIENCE is compared byte for byte with the `aud` of Google's token,
// so it is not normalised. Only the scheme and the absence of credentials are checked.
export function internalOidcAudienceProblem(value: string): string | null {
  if (!URL.canParse(value)) {
    return 'INTERNAL_OIDC_AUDIENCE must be a URL';
  }
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    return 'INTERNAL_OIDC_AUDIENCE must use https';
  }
  if (url.username !== '' || url.password !== '') {
    return 'INTERNAL_OIDC_AUDIENCE must not contain credentials';
  }
  return null;
}

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

// STORAGE_PUBLIC_URL replaces the origin of every signed storage URL (see
// StorageService). Local development only: the local Supabase stack signs URLs with
// the host of SUPABASE_URL (127.0.0.1), which a phone cannot reach, so the developer
// sets the Mac's LAN address here. Buys a working voice sample on a real phone with
// no change to the stack; costs a knob that must never exist in production, where the
// signed host is already public. Hence it is refused on Cloud Run and in production
// (see envSchema), the same pattern as DATABASE_TLS=disabled-local-only.
// Rules, value-free in their messages: http or https, and an origin only (no
// credentials, path, query or fragment); one trailing slash is tolerated.
export function storagePublicUrlProblem(value: string): string | null {
  if (!URL.canParse(value)) {
    return 'STORAGE_PUBLIC_URL must be a URL';
  }
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'STORAGE_PUBLIC_URL must use http or https';
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/' ||
    /[?#]/.test(value)
  ) {
    return 'STORAGE_PUBLIC_URL must be an origin only (scheme, host and optional port; no credentials, path, query or fragment)';
  }
  return null;
}

export const envSchema = z
  .object({
    DATABASE_URL: postgresUrlSchema('DATABASE_URL'),
    SUPABASE_URL: z.string({ error: 'SUPABASE_URL is required' }).min(1, 'SUPABASE_URL must not be empty'),
    // The service-role key bypasses RLS: it lives only in the storage adapter (SECURITY.md rule 1).
    // The message never includes the value. It is not shape-checked: a legacy JWT and a new
    // sb_secret_ key are both valid, and a wrong key fails at the first signing call.
    SUPABASE_SERVICE_ROLE_KEY: z
      .string({ error: 'SUPABASE_SERVICE_ROLE_KEY is required' })
      .min(1, 'SUPABASE_SERVICE_ROLE_KEY must not be empty'),
    // Provider keys cost money per call and live only in the adapters (SECURITY.md rule 1).
    // Required, so a missing key crashes the boot instead of the first paid call; the
    // messages never include the value, and the key is not shape-checked (formats change).
    ANTHROPIC_API_KEY: z
      .string({ error: 'ANTHROPIC_API_KEY is required' })
      .min(1, 'ANTHROPIC_API_KEY must not be empty'),
    ELEVENLABS_API_KEY: z
      .string({ error: 'ELEVENLABS_API_KEY is required' })
      .min(1, 'ELEVENLABS_API_KEY must not be empty'),
    // Model ids are configuration, not code: a model is retired or replaced without a
    // release. Costs a typo only failing at the first call (the adapter maps it to a
    // non-retryable error). The Anthropic default is a member of the SDK's Model type.
    // The ElevenLabs default is the owner's choice; the package types do not list it for
    // text-to-speech, but the paid smoke test passed with it (owner, 2026-10-30).
    ANTHROPIC_MODEL: z.string().min(1, 'ANTHROPIC_MODEL must not be empty').default('claude-haiku-5-5'),
    ELEVENLABS_MODEL: z.string().min(1, 'ELEVENLABS_MODEL must not be empty').default('eleven_v4'),
    // The one private bucket for all audio (voice samples now, story audio later under stories/).
    // Database paths are relative to it, so only this value changes between environments.
    AUDIO_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, 'AUDIO_BUCKET must be 2 to 63 lowercase letters, digits, hyphens or underscores')
      .default('audio'),
    // Optional, local development only. Validated and normalised to a bare origin below.
    STORAGE_PUBLIC_URL: z.string().optional(),
    JOB_QUEUE: z
      .enum(JOB_QUEUE_MODES, { error: `JOB_QUEUE must be one of: ${JOB_QUEUE_MODES.join(', ')}` })
      .default('none'),
    // For JOB_QUEUE=cloud-tasks and for verifying Google tokens on /internal/*: the
    // service URL (the token audience) and the service account that Cloud Tasks and
    // Cloud Scheduler sign as. Neither is secret, but the messages still omit them.
    INTERNAL_OIDC_AUDIENCE: z.string().optional(),
    INTERNAL_OIDC_SERVICE_ACCOUNT: z.string().optional(),
    ...databaseTlsShape,
  })
  .superRefine((env, ctx) => {
    addDatabaseTlsIssues(env, env.DATABASE_URL, 'DATABASE_URL', ctx);
    const problem = supabaseUrlProblem(env.SUPABASE_URL, env.DATABASE_TLS);
    if (problem !== null) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: problem });
    }
    if (env.STORAGE_PUBLIC_URL !== undefined) {
      const storageProblem = storagePublicUrlProblem(env.STORAGE_PUBLIC_URL);
      if (storageProblem !== null) {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_PUBLIC_URL'], message: storageProblem });
      }
      if (isCloudRunOrProduction(env)) {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_PUBLIC_URL'],
          message: 'STORAGE_PUBLIC_URL is for local development only and is not allowed on Cloud Run or when NODE_ENV is production',
        });
      }
    }
    if (env.INTERNAL_OIDC_AUDIENCE !== undefined) {
      const audienceProblem = internalOidcAudienceProblem(env.INTERNAL_OIDC_AUDIENCE);
      if (audienceProblem !== null) {
        ctx.addIssue({ code: 'custom', path: ['INTERNAL_OIDC_AUDIENCE'], message: audienceProblem });
      }
    }
    if (
      env.INTERNAL_OIDC_SERVICE_ACCOUNT !== undefined &&
      !z.email().safeParse(env.INTERNAL_OIDC_SERVICE_ACCOUNT).success
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_OIDC_SERVICE_ACCOUNT'],
        message: 'INTERNAL_OIDC_SERVICE_ACCOUNT must be an email address',
      });
    }
    if (env.JOB_QUEUE === 'local' && isCloudRunOrProduction(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_QUEUE'],
        message: 'JOB_QUEUE=local is for local development only and is not allowed on Cloud Run or when NODE_ENV is production',
      });
    }
    if (env.JOB_QUEUE === 'none' && isCloudRunOrProduction(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_QUEUE'],
        message: 'JOB_QUEUE=none dispatches nothing and would lose every job; a real queue (JOB_QUEUE=cloud-tasks) is required on Cloud Run or when NODE_ENV is production',
      });
    }
    if (env.JOB_QUEUE === 'cloud-tasks') {
      for (const name of ['INTERNAL_OIDC_AUDIENCE', 'INTERNAL_OIDC_SERVICE_ACCOUNT'] as const) {
        if (env[name] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} is required when JOB_QUEUE=cloud-tasks`,
          });
        }
      }
    }
  })
  // Normalise to the bare origin so the trailing slash never reaches the consumer.
  // Runs only when validation passed, so the value parses.
  .transform((env) => ({
    ...env,
    STORAGE_PUBLIC_URL: env.STORAGE_PUBLIC_URL === undefined ? undefined : new URL(env.STORAGE_PUBLIC_URL).origin,
  }));

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

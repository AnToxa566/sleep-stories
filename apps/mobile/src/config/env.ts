import { z } from 'zod';

// The app holds exactly three public values: the Supabase URL, the Supabase publishable
// key and the API URL. Never a secret, never a service-role key (SECURITY.md).
//
// Expo inlines `EXPO_PUBLIC_*` variables only when they are written as the literal
// `process.env.` followed by the variable name; `process.env[name]` or destructuring is NOT replaced.
// That is why `readPublicEnv` below names each variable literally.

// http is allowed on purpose: local testing talks to the Mac over its LAN IP (no TLS).
// Production values must be https; that is checked at release time, not here.
const HttpUrlSchema = z.string().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  },
  { error: 'must be an http(s) URL' },
);

const PUBLISHABLE_PREFIX = 'sb_publishable_';
const SECRET_PREFIX = 'sb_secret_';

// The messages below never include the rejected value: a secret key must not end up in a
// log or an error screen just because it was pasted into the wrong place.
const PublishableKeySchema = z
  .string()
  .refine((value) => !value.startsWith(SECRET_PREFIX), {
    error: 'is a secret key; the app accepts only a publishable key',
  })
  .refine((value) => value.startsWith(PUBLISHABLE_PREFIX), {
    error: `must start with ${PUBLISHABLE_PREFIX}`,
  });

const PublicEnvSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: HttpUrlSchema,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PublishableKeySchema,
  EXPO_PUBLIC_API_URL: HttpUrlSchema,
});

export type AppEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiUrl: string;
};

type RawPublicEnv = Partial<Record<keyof z.infer<typeof PublicEnvSchema>, string | undefined>>;

// Pure and exported for tests. Throws an Error that names the variables and the rule, never the values.
export function parsePublicEnv(raw: RawPublicEnv): AppEnv {
  const result = PublicEnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.');
      const missing = raw[name as keyof RawPublicEnv] === undefined;
      return `${name}: ${missing ? 'is not set' : issue.message}`;
    });
    throw new Error(`Invalid app configuration. ${problems.join('; ')}`);
  }
  const data = result.data;
  return {
    supabaseUrl: data.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: data.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    apiUrl: data.EXPO_PUBLIC_API_URL.replace(/\/+$/, ''),
  };
}

function readPublicEnv(): AppEnv {
  return parsePublicEnv({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  });
}

// Read once at start-up: a missing or wrong value stops the app at boot, not at the first request.
export const env: AppEnv = readPublicEnv();

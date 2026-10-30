import { isLoopbackDatabaseUrl, postgresUrlSchema, validateEnv as validateEnvRaw } from './env';

const PASSWORD = 'distinctive-pw-7f3a9';
const LOCAL_URL = `postgresql://postgres:${PASSWORD}@127.0.0.1:54322/postgres`;
const REMOTE_URL = `postgresql://postgres:${PASSWORD}@db.example.com:5432/postgres`;
const ANTHROPIC_KEY = 'fake-anthropic-key-for-unit-tests';
const ELEVENLABS_KEY = 'fake-elevenlabs-key-for-unit-tests';

// Everything that must never appear in an error message: the URL, the password,
// the remote host and the values of the other variables used in these tests. The
// loopback address itself is not listed because the fixed messages name it as
// the allowed value.
const SECRETS = [PASSWORD, LOCAL_URL, REMOTE_URL, 'db.example.com', 'sentinel-value', ANTHROPIC_KEY, ELEVENLABS_KEY];

// Every config needs a valid SUPABASE_URL and a service-role key; individual tests override them.
// The key here is a fake value that exists only in this file.
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = 'fake-service-role-key-for-unit-tests';
function validateEnv(config: Record<string, unknown>) {
  return validateEnvRaw({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    ELEVENLABS_API_KEY: ELEVENLABS_KEY,
    ...config,
  });
}

function failureMessage(config: Record<string, unknown>): string {
  try {
    validateEnv(config);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('validateEnv was expected to throw');
}

function expectNoLeak(message: string): void {
  for (const secret of SECRETS) {
    expect(message).not.toContain(secret);
  }
}

describe('validateEnv', () => {
  describe('SUPABASE_SERVICE_ROLE_KEY', () => {
    it('accepts a non-empty value', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL }).SUPABASE_SERVICE_ROLE_KEY).toBe(SERVICE_ROLE_KEY);
    });

    it('rejects a missing or empty value', () => {
      expect(failureMessage({ SUPABASE_SERVICE_ROLE_KEY: undefined, DATABASE_URL: REMOTE_URL })).toContain(
        'SUPABASE_SERVICE_ROLE_KEY is required',
      );
      expect(failureMessage({ SUPABASE_SERVICE_ROLE_KEY: '', DATABASE_URL: REMOTE_URL })).toContain('must not be empty');
    });

    it('never echoes the key when another variable is invalid', () => {
      expect(failureMessage({ DATABASE_URL: 'nope' })).not.toContain(SERVICE_ROLE_KEY);
    });
  });

  describe.each([
    ['ANTHROPIC_API_KEY', ANTHROPIC_KEY],
    ['ELEVENLABS_API_KEY', ELEVENLABS_KEY],
  ])('%s', (name, key) => {
    it('accepts a non-empty value', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL })[name as 'ANTHROPIC_API_KEY' | 'ELEVENLABS_API_KEY']).toBe(key);
    });

    it('rejects a missing or empty value', () => {
      expect(failureMessage({ [name]: undefined, DATABASE_URL: REMOTE_URL })).toContain(`${name} is required`);
      expect(failureMessage({ [name]: '', DATABASE_URL: REMOTE_URL })).toContain(`${name} must not be empty`);
    });

    it('never echoes the key when another variable is invalid', () => {
      expect(failureMessage({ DATABASE_URL: 'nope' })).not.toContain(key);
    });
  });

  describe('ANTHROPIC_MODEL and ELEVENLABS_MODEL', () => {
    it('default to the documented ids', () => {
      const env = validateEnv({ DATABASE_URL: REMOTE_URL });
      expect(env.ANTHROPIC_MODEL).toBe('claude-haiku-5-5');
      expect(env.ELEVENLABS_MODEL).toBe('eleven_v4');
    });

    it('accept an override and reject an empty value', () => {
      const env = validateEnv({ DATABASE_URL: REMOTE_URL, ANTHROPIC_MODEL: 'm-a', ELEVENLABS_MODEL: 'm-b' });
      expect([env.ANTHROPIC_MODEL, env.ELEVENLABS_MODEL]).toEqual(['m-a', 'm-b']);
      expect(failureMessage({ DATABASE_URL: REMOTE_URL, ANTHROPIC_MODEL: '' })).toContain('ANTHROPIC_MODEL must not be empty');
      expect(failureMessage({ DATABASE_URL: REMOTE_URL, ELEVENLABS_MODEL: '' })).toContain('ELEVENLABS_MODEL must not be empty');
    });
  });

  describe('AUDIO_BUCKET', () => {
    it('defaults to audio', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL }).AUDIO_BUCKET).toBe('audio');
    });

    it('accepts a valid name', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL, AUDIO_BUCKET: 'audio-dev_1' }).AUDIO_BUCKET).toBe('audio-dev_1');
    });

    it.each(['', 'Audio', 'a', 'au dio', 'audio/x', '../audio', '-audio'])('rejects the name %j', (name) => {
      expect(failureMessage({ DATABASE_URL: REMOTE_URL, AUDIO_BUCKET: name })).toContain('AUDIO_BUCKET must be');
    });
  });

  describe('DATABASE_URL', () => {
    it('accepts a postgresql URL', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL }).DATABASE_URL).toBe(REMOTE_URL);
    });

    it('rejects a missing, empty or non-postgres value without echoing it', () => {
      expect(failureMessage({})).toContain('DATABASE_URL is required');
      expect(failureMessage({ DATABASE_URL: '' })).toContain('must not be empty');
      const message = failureMessage({ DATABASE_URL: `mysql://u:${PASSWORD}@h/db` });
      expect(message).toContain('postgres:// or postgresql://');
      expectNoLeak(message);
    });

    it.each(['sslmode=disable', 'ssl=false', 'sslrootcert=/x', 'SSLMODE=disable', 'uselibpqcompat=true'])(
      'still refuses the TLS parameter %s',
      (parameter) => {
        const message = failureMessage({ DATABASE_URL: `${REMOTE_URL}?${parameter}` });
        expect(message).toContain('must not set TLS options');
        expectNoLeak(message);
      },
    );

    it.each(['host=db.example.com', 'hostaddr=10.0.0.1', 'HOST=db.example.com'])(
      'refuses the host override parameter %s',
      (parameter) => {
        const message = failureMessage({ DATABASE_URL: `${LOCAL_URL}?${parameter}` });
        expect(message).toContain('must not set host or hostaddr');
        expectNoLeak(message);
      },
    );
  });

  describe('DATABASE_TLS', () => {
    it('defaults to verify', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL }).DATABASE_TLS).toBe('verify');
    });

    it('accepts verify explicitly, on any host', () => {
      expect(validateEnv({ DATABASE_URL: REMOTE_URL, DATABASE_TLS: 'verify' }).DATABASE_TLS).toBe('verify');
    });

    it.each(['', 'disabled', 'false', 'VERIFY', 'Disabled-Local-Only', ' disabled-local-only', '0'])(
      'rejects the invalid value %j',
      (value) => {
        const message = failureMessage({ DATABASE_URL: LOCAL_URL, DATABASE_TLS: value });
        expect(message).toContain('DATABASE_TLS must be one of');
        expectNoLeak(message);
      },
    );

    describe('disabled-local-only', () => {
      const disabled = { DATABASE_TLS: 'disabled-local-only' };

      it.each([
        ['127.0.0.1', LOCAL_URL],
        ['localhost', `postgresql://postgres:${PASSWORD}@localhost:54322/postgres`],
        ['LOCALHOST', `postgresql://postgres:${PASSWORD}@LOCALHOST:54322/postgres`],
        ['[::1]', `postgresql://postgres:${PASSWORD}@[::1]:54322/postgres`],
        ['postgres:// scheme', `postgres://postgres:${PASSWORD}@127.0.0.1:54322/postgres`],
      ])('is accepted for the loopback host %s', (_label, url) => {
        expect(validateEnv({ DATABASE_URL: url, ...disabled }).DATABASE_TLS).toBe('disabled-local-only');
      });

      it('is accepted with NODE_ENV=development and test', () => {
        for (const NODE_ENV of ['development', 'test']) {
          expect(validateEnv({ DATABASE_URL: LOCAL_URL, ...disabled, NODE_ENV }).DATABASE_TLS).toBe(
            'disabled-local-only',
          );
        }
      });

      it.each([
        ['a remote host', REMOTE_URL],
        ['0.0.0.0', `postgresql://postgres:${PASSWORD}@0.0.0.0:5432/postgres`],
        ['an abbreviated loopback address', `postgresql://postgres:${PASSWORD}@127.1:5432/postgres`],
        ['localhost with a trailing dot', `postgresql://postgres:${PASSWORD}@localhost.:5432/postgres`],
        ['a loopback name as a suffix', `postgresql://postgres:${PASSWORD}@localhost.example.com:5432/postgres`],
        ['a loopback name as the user', `postgresql://127.0.0.1:${PASSWORD}@db.example.com:5432/postgres`],
        ['the unbracketed IPv6 text', `postgresql://postgres:${PASSWORD}@::1:5432/postgres`],
        ['a second @ that moves the host', `postgresql://u:${PASSWORD}@127.0.0.1:5432@evil.com/db`],
        ['a loopback user before @', `postgresql://127.0.0.1@evil.com/db`],
        ['a percent-encoded socket host', `postgresql://u:${PASSWORD}@%2Fvar%2Frun/db`],
      ])('is refused for %s', (_label, url) => {
        const message = failureMessage({ DATABASE_URL: url, ...disabled });
        expect(message).toContain('requires the DATABASE_URL host to be');
        expectNoLeak(message);
      });

      it.each([
        ['loopback first', `postgresql://a:${PASSWORD},127.0.0.1:2/db`],
        ['loopback last', `postgresql://127.0.0.1:2,a:${PASSWORD}/db`],
      ])('is refused for multiple hosts (%s)', (_label, url) => {
        const message = failureMessage({ DATABASE_URL: url, ...disabled });
        expect(message).toContain('DATABASE_URL');
        expectNoLeak(message);
      });

      it.each(['ho%73t=evil.com', '&host=evil.com', 'host=evil.com', '%48ost=evil.com'])(
        'is refused for the encoded host override %s',
        (parameter) => {
          const message = failureMessage({ DATABASE_URL: `${LOCAL_URL}?${parameter}`, ...disabled });
          expect(message).toContain('must not set host or hostaddr');
          expectNoLeak(message);
        },
      );

      it('accepts the long spelling of the IPv6 loopback address, which URL normalises', () => {
        const url = `postgresql://postgres:${PASSWORD}@[0:0:0:0:0:0:0:1]:54322/postgres`;
        expect(validateEnv({ DATABASE_URL: url, ...disabled }).DATABASE_TLS).toBe('disabled-local-only');
      });

      it.each(['K_SERVICE', 'K_REVISION', 'K_CONFIGURATION', 'CLOUD_RUN_JOB'])(
        'is refused when %s is set',
        (variable) => {
          const message = failureMessage({ DATABASE_URL: LOCAL_URL, ...disabled, [variable]: 'sentinel-value' });
          expect(message).toContain('not allowed on Cloud Run');
          expectNoLeak(message);
        },
      );

      it('is refused when a Cloud Run variable is set to an empty string', () => {
        expect(failureMessage({ DATABASE_URL: LOCAL_URL, ...disabled, K_SERVICE: '' })).toContain(
          'not allowed on Cloud Run',
        );
      });

      it.each(['production', 'PRODUCTION', ' Production '])('is refused when NODE_ENV is %j', (NODE_ENV) => {
        const message = failureMessage({ DATABASE_URL: LOCAL_URL, ...disabled, NODE_ENV });
        expect(message).toContain('not allowed when NODE_ENV is production');
        expectNoLeak(message);
      });

      it('reports every failed condition together, still without any value', () => {
        const message = failureMessage({
          DATABASE_URL: REMOTE_URL,
          ...disabled,
          NODE_ENV: 'production',
          K_SERVICE: 'sentinel-value',
        });
        expect(message).toContain('requires the DATABASE_URL host');
        expect(message).toContain('not allowed on Cloud Run');
        expect(message).toContain('not allowed when NODE_ENV is production');
        expectNoLeak(message);
      });

      it('does not make the Cloud Run and production checks apply to verify mode', () => {
        expect(
          validateEnv({ DATABASE_URL: REMOTE_URL, DATABASE_TLS: 'verify', NODE_ENV: 'production', K_SERVICE: 'x' })
            .DATABASE_TLS,
        ).toBe('verify');
      });
    });
  });
});

describe('STORAGE_PUBLIC_URL', () => {
  const base = { DATABASE_URL: REMOTE_URL };

  it('is optional', () => {
    expect(validateEnv(base).STORAGE_PUBLIC_URL).toBeUndefined();
  });

  it.each([
    ['http://192.168.1.20:54321', 'http://192.168.1.20:54321'],
    ['http://192.168.1.20:54321/', 'http://192.168.1.20:54321'],
    ['https://storage.example.test', 'https://storage.example.test'],
    ['https://storage.example.test/', 'https://storage.example.test'],
  ])('accepts the origin %s and normalises it to %s', (value, expected) => {
    expect(validateEnv({ ...base, STORAGE_PUBLIC_URL: value }).STORAGE_PUBLIC_URL).toBe(expected);
  });

  it.each([
    '',
    'not a url',
    'ftp://192.168.1.20:54321',
    'http://192.168.1.20:54321/storage',
    'http://192.168.1.20:54321?x=1',
    'http://192.168.1.20:54321/?x=1',
    'http://192.168.1.20:54321/#frag',
    'http://192.168.1.20:54321#',
    'http://user:sentinel-value@192.168.1.20:54321',
    'http://sentinel-value@192.168.1.20:54321',
  ])('rejects %j without echoing it', (value) => {
    const message = failureMessage({ ...base, STORAGE_PUBLIC_URL: value });
    expect(message).toContain('STORAGE_PUBLIC_URL');
    expectNoLeak(message);
  });

  it('is rejected when NODE_ENV is production, without echoing the value', () => {
    const message = failureMessage({
      ...base,
      NODE_ENV: 'production',
      STORAGE_PUBLIC_URL: 'http://sentinel-value.test:54321',
    });
    expect(message).toContain('STORAGE_PUBLIC_URL is for local development only');
    expectNoLeak(message);
    expect(message).not.toContain('sentinel-value.test');
  });

  it.each(['K_SERVICE', 'K_REVISION', 'K_CONFIGURATION', 'CLOUD_RUN_JOB'])('is rejected on Cloud Run (%s set)', (name) => {
    expect(failureMessage({ ...base, [name]: 'x', STORAGE_PUBLIC_URL: 'http://192.168.1.20:54321' })).toContain(
      'STORAGE_PUBLIC_URL is for local development only',
    );
  });

  it('is accepted outside production', () => {
    expect(
      validateEnv({ ...base, NODE_ENV: 'development', STORAGE_PUBLIC_URL: 'http://192.168.1.20:54321' }).STORAGE_PUBLIC_URL,
    ).toBe('http://192.168.1.20:54321');
  });
});

describe('SUPABASE_URL', () => {
  const local = { DATABASE_URL: LOCAL_URL, DATABASE_TLS: 'disabled-local-only' };
  const remote = { DATABASE_URL: REMOTE_URL };

  it('is required and must not be empty', () => {
    expect(failureMessage({ ...remote, SUPABASE_URL: undefined })).toContain('SUPABASE_URL is required');
    expect(failureMessage({ ...remote, SUPABASE_URL: '' })).toContain('SUPABASE_URL must not be empty');
  });

  it.each([
    'https://abcdefgh.supabase.co',
    'https://abcdefgh.supabase.co/',
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'http://[::1]:54321',
    'http://[0:0:0:0:0:0:0:1]:54321',
  ])('accepts %s in the default TLS mode', (url) => {
    expect(validateEnv({ ...remote, SUPABASE_URL: url }).SUPABASE_URL).toBe(url);
  });

  it.each([
    'http://example.com',
    'http://abcdefgh.supabase.co',
    'http://192.168.1.5:54321',
    'http://10.0.0.2:54321',
    'ftp://127.0.0.1',
    'not a url',
  ])('refuses %s in the default TLS mode, without echoing it', (url) => {
    const message = failureMessage({ ...remote, SUPABASE_URL: url });
    expect(message).toContain('SUPABASE_URL');
    expect(message).not.toContain(url);
  });

  it.each(['192.168.1.5', '192.168.255.255', '10.0.0.2', '10.255.1.1', '172.16.0.1', '172.31.255.255'])(
    'accepts the private-network address %s only with DATABASE_TLS=disabled-local-only',
    (host) => {
      const url = `http://${host}:54321`;
      expect(validateEnv({ ...local, SUPABASE_URL: url }).SUPABASE_URL).toBe(url);
      expect(failureMessage({ ...remote, SUPABASE_URL: url })).toContain('SUPABASE_URL must use https');
    },
  );

  it('normalises an obfuscated private address before judging it', () => {
    expect(validateEnv({ ...local, SUPABASE_URL: 'http://0300.0250.0.1:54321' }).SUPABASE_URL).toBe(
      'http://0300.0250.0.1:54321',
    );
  });

  it.each(['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '8.8.8.8', '100.64.0.1', '169.254.169.254', '0.0.0.0'])(
    'refuses the non-private address %s even with DATABASE_TLS=disabled-local-only',
    (host) => {
      const message = failureMessage({ ...local, SUPABASE_URL: `http://${host}:54321` });
      expect(message).toContain('SUPABASE_URL must use https');
      expect(message).not.toContain(host);
    },
  );

  // supabaseUrlProblem judges the URL by the TLS mode alone and does not look at the
  // environment; what stops this config is the check on the local switch itself.
  it('refuses the whole config on Cloud Run, via the DATABASE_TLS check, even though the private address is allowed by that switch', () => {
    const message = failureMessage({ ...local, K_SERVICE: 'x', SUPABASE_URL: 'http://192.168.1.5:54321' });
    expect(message).toContain('DATABASE_TLS=disabled-local-only is not allowed on Cloud Run');
    expect(message).not.toContain('SUPABASE_URL must use https');
  });

  it('refuses a private hostname that is not an IPv4 literal', () => {
    expect(failureMessage({ ...local, SUPABASE_URL: 'http://mac.local:54321' })).toContain('must use https');
  });

  it.each([
    'https://user:pw@abcdefgh.supabase.co',
    'https://abcdefgh.supabase.co/auth/v1',
    'https://abcdefgh.supabase.co?x=1',
    'https://abcdefgh.supabase.co/#frag',
  ])('refuses a URL that is not an origin only: %s', (url) => {
    const message = failureMessage({ ...remote, SUPABASE_URL: url });
    expect(message).toContain('must be an origin only');
    expect(message).not.toContain('pw@');
  });
});

describe('isLoopbackDatabaseUrl', () => {
  it.each([
    'postgresql://u:p@127.0.0.1:54322/postgres',
    'postgresql://u:p@localhost/postgres',
    'postgresql://u:p@LOCALHOST/postgres',
    'postgresql://u:p@[::1]:54322/postgres',
    'postgresql://u:p@[0:0:0:0:0:0:0:1]/postgres',
    'postgresql://u:p@127.0.0.1/postgres?application_name=x',
  ])('accepts %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(true);
  });

  it.each([
    'postgresql://u:p@db.example.com/postgres',
    'postgresql://127.0.0.1:p@db.example.com/postgres',
    'postgresql://u:p@127.1/postgres',
    'postgresql://u:p@localhost./postgres',
    'postgresql://u:p@0.0.0.0/postgres',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(false);
  });

  // pg lets these parameters override the URL host, so the host in the URL proves nothing.
  it.each([
    'host=db.example.com',
    'hostaddr=10.0.0.1',
    'HOST=db.example.com',
    'HostAddr=10.0.0.1',
    '%68ost=db.example.com',
    'host=127.0.0.1',
    'application_name=x&host=db.example.com',
    'host=',
  ])('refuses a loopback URL that carries the host override parameter %s', (parameter) => {
    expect(isLoopbackDatabaseUrl(`postgresql://u:p@127.0.0.1:54322/postgres?${parameter}`)).toBe(false);
    expect(isLoopbackDatabaseUrl(`postgresql://u:p@localhost/postgres?${parameter}`)).toBe(false);
  });

  it('keeps DATABASE_TLS=disabled-local-only closed for a host override, with a message that does not echo it', () => {
    const message = failureMessage({
      DATABASE_URL: `postgresql://u:${PASSWORD}@127.0.0.1/postgres?host=db.example.com`,
      DATABASE_TLS: 'disabled-local-only',
    });
    expect(message).toContain('must not set host or hostaddr');
    expectNoLeak(message);
  });
});

describe('postgresUrlSchema', () => {
  it('uses the given name in its messages and never echoes the value', () => {
    const result = postgresUrlSchema('DIRECT_URL').safeParse(`${REMOTE_URL}?sslmode=disable`);
    expect(result.success).toBe(false);
    const messages = JSON.stringify(result.error?.issues);
    expect(messages).toContain('DIRECT_URL must not set TLS options');
    expectNoLeak(messages);
  });

  it('accepts a plain postgres URL', () => {
    expect(postgresUrlSchema('DIRECT_URL').safeParse(REMOTE_URL).success).toBe(true);
  });
});

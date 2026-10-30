import { parsePublicEnv } from './env';

const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'http://192.168.0.10:54321',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_exampleexampleexample',
  EXPO_PUBLIC_API_URL: 'http://192.168.0.10:3000/api/',
};

describe('parsePublicEnv', () => {
  it('accepts valid values and trims the trailing slash of the API URL', () => {
    expect(parsePublicEnv(valid)).toEqual({
      supabaseUrl: 'http://192.168.0.10:54321',
      supabasePublishableKey: 'sb_publishable_exampleexampleexample',
      apiUrl: 'http://192.168.0.10:3000/api',
    });
  });

  it('accepts https URLs', () => {
    expect(
      parsePublicEnv({ ...valid, EXPO_PUBLIC_API_URL: 'https://api.example.com/api' }).apiUrl,
    ).toBe('https://api.example.com/api');
  });

  it('refuses a secret key without echoing it', () => {
    const secret = 'sb_secret_THIS_MUST_NOT_APPEAR_IN_THE_MESSAGE';
    let message = '';
    try {
      parsePublicEnv({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(message).toContain('secret key');
    expect(message).not.toContain('THIS_MUST_NOT_APPEAR');
    expect(message).not.toContain(secret);
  });

  it('refuses a key without the publishable prefix, without echoing it', () => {
    const key = 'legacy-anon-key-value';
    expect(() => parsePublicEnv({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(
      /must start with sb_publishable_/,
    );
    try {
      parsePublicEnv({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key });
    } catch (error) {
      expect((error as Error).message).not.toContain(key);
    }
  });

  it('refuses non-http URLs and missing values by name', () => {
    expect(() => parsePublicEnv({ ...valid, EXPO_PUBLIC_API_URL: 'ftp://host/api' })).toThrow(
      /EXPO_PUBLIC_API_URL: must be an http\(s\) URL/,
    );
    expect(() => parsePublicEnv({ ...valid, EXPO_PUBLIC_SUPABASE_URL: 'not a url' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL/,
    );
    expect(() => parsePublicEnv({})).toThrow(/EXPO_PUBLIC_API_URL: is not set/);
  });
});

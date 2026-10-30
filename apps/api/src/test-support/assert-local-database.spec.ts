import { assertLocalDatabase } from './assert-local-database';

describe('assertLocalDatabase', () => {
  it.each([
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://postgres:postgres@localhost:54322/postgres',
    'postgresql://postgres:postgres@[::1]:54322/postgres',
  ])('accepts a loopback database', (url) => {
    expect(() => assertLocalDatabase({ DATABASE_URL: url })).not.toThrow();
  });

  it.each([
    ['a cloud pooler host', 'postgresql://postgres.ref:distinctive-pw@aws-0-eu.pooler.supabase.com:6543/postgres'],
    ['a loopback name used as the user', 'postgresql://127.0.0.1:distinctive-pw@db.example.com/postgres'],
    ['a host override parameter', 'postgresql://u:distinctive-pw@127.0.0.1/postgres?host=db.example.com'],
    ['a hostaddr override parameter', 'postgresql://u:distinctive-pw@127.0.0.1/postgres?hostaddr=10.0.0.1'],
    ['an upper-case host override', 'postgresql://u:distinctive-pw@localhost/postgres?HOST=db.example.com'],
    ['a percent-encoded host override', 'postgresql://u:distinctive-pw@127.0.0.1/postgres?%68ost=db.example.com'],
    ['a TLS parameter', 'postgresql://u:distinctive-pw@127.0.0.1/postgres?sslmode=disable'],
    ['a non-postgres scheme', 'http://u:distinctive-pw@127.0.0.1/postgres'],
    ['garbage', 'distinctive-pw'],
  ])('refuses %s without echoing the URL', (_label, url) => {
    let message = '';
    try {
      assertLocalDatabase({ DATABASE_URL: url });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('refuse to run');
    expect(message).not.toContain('distinctive-pw');
    expect(message).not.toContain('example.com');
    expect(message).not.toContain('supabase.com');
  });

  it('refuses when DATABASE_URL is not set', () => {
    expect(() => assertLocalDatabase({})).toThrow('refuse to run');
  });
});

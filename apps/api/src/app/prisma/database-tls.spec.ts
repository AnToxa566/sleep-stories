import type { DatabaseTlsMode } from '../config/env';
import { resolveDatabaseSsl } from './database-tls';
import { SUPABASE_ROOT_CA } from './supabase-ca';

describe('resolveDatabaseSsl', () => {
  it('pins the Supabase root CA in verify mode', () => {
    expect(resolveDatabaseSsl({ mode: 'verify' })).toEqual({ ca: SUPABASE_ROOT_CA });
  });

  it('never weakens verification in verify mode', () => {
    const ssl = resolveDatabaseSsl({ mode: 'verify' });
    expect(ssl).not.toBe(false);
    expect(ssl).not.toHaveProperty('rejectUnauthorized');
  });

  it('turns TLS off only for disabled-local-only', () => {
    expect(resolveDatabaseSsl({ mode: 'disabled-local-only' })).toBe(false);
  });

  it('throws on an unknown mode instead of picking a behaviour', () => {
    expect(() => resolveDatabaseSsl({ mode: 'off' as DatabaseTlsMode })).toThrow('Unknown DATABASE_TLS mode');
  });

  it('pins a PEM certificate block, not an empty or placeholder string', () => {
    expect(SUPABASE_ROOT_CA.trim()).toMatch(/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/);
  });
});

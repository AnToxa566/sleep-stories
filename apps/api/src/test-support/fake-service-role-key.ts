// Jest setupFiles for jest.integration.config.cts. The env schema requires
// SUPABASE_SERVICE_ROLE_KEY, but integration tests never reach real storage: a spec that
// needs signed URLs overrides StorageService. A fake value is set unconditionally, so a
// real key in apps/api/.env is not used by tests and cannot be sent anywhere by them.
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fake-service-role-key-for-integration-tests';

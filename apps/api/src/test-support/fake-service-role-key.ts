// Jest setupFiles for jest.integration.config.cts. The env schema requires
// SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY and ELEVENLABS_API_KEY, but integration
// tests never reach real storage or a provider: a spec that needs one overrides the
// adapter. Fake values are set unconditionally, so a real key in apps/api/.env is not
// used by tests and cannot be sent anywhere by them.
//
// The one exception is the opt-in paid smoke test (generation-smoke.int-spec.ts), which
// must call the real providers and the local Storage. With RUN_PAID_SMOKE=1 nothing is
// faked here, so the values come from apps/api/.env through ConfigModule. Costs: with
// that flag every spec in the same run sees the real keys; the owner's command runs only
// the smoke spec (the other specs replace the adapters anyway).
if (process.env['RUN_PAID_SMOKE'] !== '1') {
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fake-service-role-key-for-integration-tests';
  process.env['ANTHROPIC_API_KEY'] = 'fake-anthropic-key-for-integration-tests';
  process.env['ELEVENLABS_API_KEY'] = 'fake-elevenlabs-key-for-integration-tests';
}

// Integration tests: they boot the real AppModule against the LOCAL Supabase
// database. Run with `npx nx test-integration api`. Same transform and jose
// workaround as jest.config.cts (see the comments there).
module.exports = {
  displayName: 'api-integration',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/*.int-spec.ts'],
  // Refuses to run unless DATABASE_URL is a loopback host.
  globalSetup: '<rootDir>/src/test-support/integration-global-setup.ts',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }]
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The suites share one database and some of them hold row locks: one at a time.
  maxWorkers: 1,
  verbose: true,
  testTimeout: 30000,
  coverageDirectory: '../../coverage/apps/api-integration'
};

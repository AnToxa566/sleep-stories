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
  // Supplies fake service-role and provider keys so the env schema passes without real keys.
  setupFiles: ['<rootDir>/src/test-support/fake-service-role-key.ts'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }]
  },
  // Same ESM-only list as jest.config.cts (see the comment there).
  transformIgnorePatterns: [
    '/node_modules/(?!(jose|music-metadata|@borewit/text-codec|content-type|file-type|media-typer|strtok3|token-types|uint8array-extras|win-guid|@tokenizer/inflate)/)',
  ],
  // Jest resolves music-metadata's package exports with the "types" condition and loads
  // lib/core.d.ts (no parseBuffer), because its "node" entry only has import and
  // module-sync. Pointing the name at the Node entry file fixes that for tests only.
  moduleNameMapper: {
    '^music-metadata$': '<rootDir>/../../node_modules/music-metadata/lib/index.js',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The suites share one database and some of them hold row locks: one at a time.
  maxWorkers: 1,
  verbose: true,
  testTimeout: 30000,
  coverageDirectory: '../../coverage/apps/api-integration'
};

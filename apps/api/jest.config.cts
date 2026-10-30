module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }]
  },
  // jose 6 ships ES modules only (its package.json has no "require" export), so Jest
  // must compile it to CommonJS like our own code. ts-jest does that for .js files
  // when allowJs is on (tsconfig.spec.json). Costs a slower first run for jose only.
  //
  // tsconfig.spec.json targets es2022, and es2022 turns on useDefineForClassFields, so
  // tests compile our class fields differently from the production build
  // (tsconfig.app.json, es2021, where it is off). Setting
  // "useDefineForClassFields": false in tsconfig.spec.json to match production was
  // tried and does not work: ts-jest compiles jose with the same file, and jose's
  // compiled classes (`super(...), this.claim = ...` in a comma expression, plus class
  // fields) then throw "Must call super constructor in derived class before accessing
  // 'this'" on every jose error, so the whole verifier suite fails (20 tests failed).
  // Fixing it would need a separate tsconfig for the jose transform here and in
  // jest.integration.config.cts. The mismatch stays.
  // (JSON cannot carry this note: no tsconfig in this repo has comments.)
  //
  // music-metadata 12 (audio-duration.ts) is ESM-only too, and so are these of its
  // dependencies (checked on 12.2.1): @borewit/text-codec, content-type, file-type,
  // media-typer, strtok3, token-types, uint8array-extras, win-guid, @tokenizer/inflate.
  // content-type and media-typer sit in node_modules/music-metadata/node_modules, so the
  // negative lookahead is applied after every '/node_modules/' occurrence. `debug` and
  // @tokenizer/token are CommonJS and must stay out of the list. The list must be
  // revisited when music-metadata is upgraded.
  //
  // Production does not use this workaround at all: webpack keeps jose external, so
  // Node itself require()s the ESM-only package, which needs Node 22.12 or later
  // (require(esm) is unflagged from that version). Tests do not prove that path.
  transformIgnorePatterns: [
    '/node_modules/(?!(jose|music-metadata|@borewit/text-codec|content-type|file-type|media-typer|strtok3|token-types|uint8array-extras|win-guid|@tokenizer/inflate)/)',
  ],
  // Integration specs need the local database; they run through
  // `nx test-integration api` (jest.integration.config.cts), never as unit tests.
  testPathIgnorePatterns: ['/node_modules/', '\\.int-spec\\.ts$'],
  // Jest resolves music-metadata's package exports with the "types" condition and loads
  // lib/core.d.ts (no parseBuffer), because its "node" entry only has import and
  // module-sync. Pointing the name at the Node entry file fixes that for tests only.
  moduleNameMapper: {
    '^music-metadata$': '<rootDir>/../../node_modules/music-metadata/lib/index.js',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api'
};

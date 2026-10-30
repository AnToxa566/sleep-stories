// Unit tests for PURE TypeScript modules only (tokens, strings, storage and API logic
// with injected fakes, the route gate). Nothing here loads React Native or the Expo
// runtime: jest-expo and @testing-library/react-native are not approved, so screens
// and components are checked by typecheck, lint, export and the phone.
module.exports = {
  displayName: 'mobile',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }]
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  coverageDirectory: '../../coverage/apps/mobile'
};

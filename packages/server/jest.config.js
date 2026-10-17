/** Unit tests: no database, no network. */
const esm = require('./jest.esm');

module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json', diagnostics: { ignoreCodes: [151002] } }],
    // Only dependencies: our own workspace packages are already CommonJS.
    'node_modules/.+\\.m?js$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json', diagnostics: false }],
  },
  ...esm,
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  clearMocks: true,
};

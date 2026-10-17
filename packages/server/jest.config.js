/** Unit tests: no database, no network. */
const esm = require('./jest.esm');

module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(ts|js|mjs)$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  ...esm,
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  clearMocks: true,
};

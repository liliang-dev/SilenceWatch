/**
 * End-to-end tests against a real PostgreSQL.
 *
 * Set TEST_DATABASE_URL (or DATABASE_URL) to a database that may be migrated and
 * truncated; the suite refuses to run against anything it was not pointed at.
 */
const esm = require('./jest.esm');

module.exports = {
  rootDir: 'test',
  testEnvironment: 'node',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(ts|js|mjs)$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  ...esm,
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 60000,
  globalSetup: '<rootDir>/global-setup.ts',
  clearMocks: true,
};

/** Unit tests: no database, no network. */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  clearMocks: true,
};

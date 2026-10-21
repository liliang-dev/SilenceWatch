/**
 * Packages that ship ES modules only. The server compiles to CommonJS and Jest
 * loads it that way, so these have to go through the same transform as our own
 * sources or `require` refuses them.
 */
const esmPackages = ['better-auth', '@better-auth', 'better-call', '@better-fetch', 'nanostores', '@noble', 'jose', 'rou3', '@simplewebauthn', 'kysely'];

// pnpm nests every package under node_modules/.pnpm/<name>@<version>/node_modules/<name>.
const ignore = `/node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:${esmPackages
  .map((name) => name.replace(/[/@.-]/g, (c) => `\\${c}`))
  .join('|')})/)`;

module.exports = {
  transformIgnorePatterns: [ignore],
};

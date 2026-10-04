/**
 * The licence is one thing, said once, and the brand is outside it.
 *
 * Both are claims made in several places that nothing connects: a LICENSE in four
 * directories, a `license` field in four manifests, a label on the image, a
 * paragraph in the README, and a NOTICE that lists the files the licence does not
 * cover. Each can be edited alone, in a pull request about something else, and
 * the result is a project that says Apache-2.0 in one place and something else in
 * another — which, for a licence, is the worst kind of wrong, because someone
 * relied on the part they read.
 *
 * So they are compared. This runs before anything is built and needs no install.
 */
import { existsSync, readFileSync } from 'node:fs';

const problems = [];
const read = (path) => readFileSync(path, 'utf8');
const expect = (condition, message) => {
  if (!condition) problems.push(message);
};

// 1. The licence text. Four copies, because the starter and the shared package are
//    distributed on their own; all four must be the same text, and it must be the
//    Apache License 2.0 and not a paraphrase of it.
const copies = [
  'LICENSE',
  'packages/shared/LICENSE',
  'clients/spring-boot-starter/LICENSE',
  'examples/spring-boot-demo/LICENSE',
];
const root = read(copies[0]);
expect(
  /^\s*Apache License\s+Version 2\.0, January 2004/.test(root),
  'LICENSE is not the Apache License, Version 2.0',
);
expect(root.includes('END OF TERMS AND CONDITIONS'), 'LICENSE is truncated: no "END OF TERMS AND CONDITIONS"');
for (const copy of copies.slice(1)) {
  expect(read(copy) === root, `${copy} differs from the root LICENSE`);
}
expect(!existsSync('LICENSE.Apache-2.0'), 'LICENSE.Apache-2.0 is back: the root LICENSE is that text now');

// 2. Every statement of which licence it is.
for (const manifest of ['package.json', 'packages/server/package.json', 'packages/web/package.json', 'packages/shared/package.json']) {
  const declared = JSON.parse(read(manifest)).license;
  expect(declared === 'Apache-2.0', `${manifest}: "license" is ${JSON.stringify(declared)}, expected "Apache-2.0"`);
}
expect(
  /org\.opencontainers\.image\.licenses="Apache-2\.0"/.test(read('Dockerfile')),
  'Dockerfile: the image licence label is not "Apache-2.0"',
);
expect(
  /<name>Apache License, Version 2\.0<\/name>/.test(read('clients/spring-boot-starter/pom.xml')),
  'the starter pom does not declare the Apache License, Version 2.0',
);

// 3. The brand. The files NOTICE says are not licensed have to exist, or the
//    exclusion names nothing; and the policy has to name each of them, or a file
//    can be renamed and quietly fall back under the licence.
const notice = read('NOTICE');
const policy = read('TRADEMARK.md');
const excluded = [
  'packages/web/public/logo.svg',
  'packages/web/public/logo-dark.svg',
  'packages/web/public/favicon.svg',
  'packages/web/public/favicon.ico',
  'packages/web/public/apple-touch-icon.png',
  'packages/web/public/logo-96.png',
  'packages/web/public/logo-dark-96.png',
  'packages/web/src/app/app.component.html',
  'packages/web/src/app/features/auth/login/login.component.html',
];
for (const file of excluded) {
  expect(existsSync(file), `${file} is listed as excluded from the licence but does not exist`);
  expect(notice.includes(file), `NOTICE does not list ${file} as excluded from the licence`);
  expect(policy.includes(file), `TRADEMARK.md does not list ${file} as excluded from the licence`);
}

// 4. No document still describes the old split as current.
for (const file of ['CONTRIBUTING.md', 'docs/development.md', '.github/pull_request_template.md', 'NOTICE', 'TRADEMARK.md']) {
  expect(!/AGPL/i.test(read(file)), `${file} still mentions AGPL`);
}

if (problems.length > 0) {
  console.error('Licence check failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`Licence check passed: Apache-2.0 in ${copies.length} LICENSE files, 4 manifests, the image label and the starter pom; ${excluded.length} brand files excluded.`);

// Prepares what the site build needs and the repository does not keep a second
// copy of:
//
//   1. the brand artwork, copied from the application's own files — one source
//      for the logo, so the site cannot drift from it, and the repository holds
//      no further copy of a file the licence leaves out;
//   2. the reference pages, generated from the Markdown in /docs — one source for
//      the API, self-hosting, authentication and security documentation;
//   3. the social-sharing images, drawn from the logo.
//
// Everything it writes is ignored by git and rebuilt every time.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const REPOSITORY = 'https://github.com/liliang-dev/SilenceWatch';

const ensure = (path) => mkdirSync(dirname(path), { recursive: true });
const copy = (from, to) => {
  ensure(to);
  copyFileSync(from, to);
};

// --- 1. the brand artwork ----------------------------------------------------
copy(join(repo, 'packages/web/public/logo.svg'), join(root, 'src/assets/logo.svg'));
copy(join(repo, 'packages/web/public/logo-dark.svg'), join(root, 'src/assets/logo-dark.svg'));
copy(join(repo, 'packages/web/public/favicon.svg'), join(root, 'public/favicon.svg'));
copy(join(repo, 'packages/web/public/favicon.ico'), join(root, 'public/favicon.ico'));
copy(join(repo, 'packages/web/public/apple-touch-icon.png'), join(root, 'public/apple-touch-icon.png'));

// --- 2. the reference pages --------------------------------------------------
//
// English only, because the Markdown is. English is the site's language, so they
// are served at /docs/reference/ and the French summaries link to them there,
// rather than pretending to a translation.
const REFERENCE = {
  api: {
    file: 'api.md',
    description:
      'The SilenceWatch REST API: heartbeat endpoints, checks, notification channels, authentication, errors and rate limits.',
  },
  'self-hosting': {
    file: 'self-hosting.md',
    description:
      'Self-host SilenceWatch with Docker Compose or Docker Swarm: requirements, configuration, HTTPS, backups, upgrades and monitoring the monitor.',
  },
  authentication: {
    file: 'authentication.md',
    description:
      'How people sign in to SilenceWatch: passkeys, passwords, or Google and Microsoft; the administrator account, sessions and what to do when someone is locked out.',
  },
  security: {
    file: 'security.md',
    description:
      'The SilenceWatch threat model: what is protected, how, and how to report a vulnerability.',
  },
};

const outDir = join(root, 'src/content/docs/docs/reference');
rmSync(outDir, { recursive: true, force: true });

/** Links in /docs are written for the repository; on the site they go to the site or to GitHub. */
function rewriteLinks(markdown, fromFile) {
  const pages = Object.fromEntries(Object.entries(REFERENCE).map(([slug, p]) => [p.file, slug]));
  return markdown.replace(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g, (whole, target, hash = '') => {
    if (/^(https?:|mailto:)/.test(target)) return whole;
    const name = target.replace(/^\.\//, '');
    if (pages[name]) return `](/docs/reference/${pages[name]}/${hash})`;
    const absolute = resolve(dirname(join(repo, 'docs', fromFile)), target);
    const inRepo = absolute.slice(repo.length + 1);
    return `](${REPOSITORY}/blob/dev/${inRepo}${hash})`;
  });
}

for (const [slug, page] of Object.entries(REFERENCE)) {
  const source = readFileSync(join(repo, 'docs', page.file), 'utf8');
  const heading = source.match(/^# (.+)$/m);
  if (heading === null) throw new Error(`docs/${page.file} has no top-level heading`);
  const body = rewriteLinks(source.replace(heading[0], '').trimStart(), page.file);
  const front = [
    '---',
    `title: ${JSON.stringify(heading[1])}`,
    `description: ${JSON.stringify(page.description)}`,
    '---',
    '',
    '',
  ].join('\n');
  const target = join(outDir, `${slug}.md`);
  ensure(target);
  writeFileSync(
    target,
    `${front}{/* Generated from docs/${page.file} by scripts/prepare.mjs. Edit that file. */}\n\n${body}`,
  );
}

// --- 3. the sharing images ---------------------------------------------------
//
// 1200×630, what every network crops to. Drawn rather than designed once and
// committed: that would be another copy of the logo, and it would say one thing
// in one language.
const CARDS = {
  fr: {
    title: 'Monitoring de jobs',
    lines: ['Vos jobs ne vous préviennent pas', 'quand ils s’arrêtent. Nous oui.'],
    foot: 'Open source · Auto-hébergeable · Spring Boot · Python · Laravel',
  },
  en: {
    title: 'Job monitoring',
    lines: ['Your jobs don’t tell you when', 'they stop. We do.'],
    foot: 'Open source · Self-hostable · Spring Boot · Python · Laravel',
  },
};

// The artwork's children: what sits between the root element's opening tag and
// its closing one. Sliced rather than stripped with patterns, so the leading
// licence comment falls outside the slice and nothing has to be "sanitised".
// The white tile, for the card's black ground.
const logo = readFileSync(join(root, 'src/assets/logo-dark.svg'), 'utf8');
const mark = logo.slice(logo.indexOf('>', logo.indexOf('<svg')) + 1, logo.lastIndexOf('</svg>'));

const FONT = "'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Black and white, like the site: white type on black, the question in grey and
// the answer in white, a field of grey dots, and one dot in red, the only colour,
// as it is everywhere: a job that has gone quiet.
const dots = [];
for (let x = 640; x <= 1176; x += 24) {
  for (let y = 48; y <= 600; y += 24) {
    const fade = Math.min(1, (x - 640) / 260) * Math.min(1, (600 - y) / 200, (y - 48) / 120);
    if (fade > 0.05) dots.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="#ffffff" fill-opacity="${(0.22 * fade).toFixed(3)}"/>`);
  }
}

for (const [lang, card] of Object.entries(CARDS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0a0a"/>
  ${dots.join('')}
  <circle cx="1000" cy="264" r="34" fill="none" stroke="#ff5a63" stroke-opacity="0.35" stroke-width="2"/>
  <circle cx="1000" cy="264" r="9" fill="#ff5a63"/>
  <g transform="translate(88 96) scale(0.5)">${mark}</g>
  <text x="248" y="188" font-family="${FONT}" font-size="46" font-weight="700" fill="#ffffff">Silence<tspan fill="#8f8f8f" font-weight="500">Watch</tspan></text>
  <text x="88" y="340" font-family="${FONT}" font-size="56" font-weight="700" fill="#ffffff">${escape(card.title)}</text>
  <text x="88" y="418" font-family="${FONT}" font-size="36" fill="#a3a3a3">${escape(card.lines[0])}</text>
  <text x="88" y="466" font-family="${FONT}" font-size="36" fill="#ffffff">${escape(card.lines[1])}</text>
  <text x="88" y="560" font-family="${FONT}" font-size="26" fill="#8f8f8f">${escape(card.foot)}</text>
  <text x="1112" y="170" font-family="${FONT}" font-size="26" fill="#ffffff" text-anchor="end">silencewatch.com</text>
</svg>`;
  const target = join(root, `public/og/${lang}.png`);
  ensure(target);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(target);
}

console.log('site assets ready');

// Prepares what the site build needs and the repository does not keep a second
// copy of:
//
//   1. the brand artwork, copied from the application's own files — one source
//      for the logo, so the site cannot drift from it, and the repository holds
//      no further copy of a file the licence leaves out;
//   2. the reference pages, generated from the Markdown in /docs — one source for
//      the API, self-hosting and security documentation;
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
copy(join(repo, 'packages/web/public/favicon.svg'), join(root, 'public/favicon.svg'));

// --- 2. the reference pages --------------------------------------------------
//
// English only, because the Markdown is. They are served under /en/ and the
// French sidebar links to them there, rather than pretending to a translation.
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
  security: {
    file: 'security.md',
    description:
      'The SilenceWatch threat model: what is protected, how, and how to report a vulnerability.',
  },
};

const outDir = join(root, 'src/content/docs/en/docs/reference');
rmSync(outDir, { recursive: true, force: true });

/** Links in /docs are written for the repository; on the site they go to the site or to GitHub. */
function rewriteLinks(markdown, fromFile) {
  const pages = Object.fromEntries(Object.entries(REFERENCE).map(([slug, p]) => [p.file, slug]));
  return markdown.replace(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g, (whole, target, hash = '') => {
    if (/^(https?:|mailto:)/.test(target)) return whole;
    const name = target.replace(/^\.\//, '');
    if (pages[name]) return `](/en/docs/reference/${pages[name]}/${hash})`;
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
    `editUrl: ${REPOSITORY}/edit/dev/docs/${page.file}`,
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
    lines: ['Vos Jobs ne vous préviennent pas', 'quand ils s’arrêtent. Nous oui.'],
    foot: 'Open source · Auto-hébergeable · Spring Boot',
  },
  en: {
    title: 'Job monitoring',
    lines: ['Your jobs don’t tell you when', 'they stop. We do.'],
    foot: 'Open source · Self-hostable · Spring Boot',
  },
};

// The artwork's children: what sits between the root element's opening tag and
// its closing one. Sliced rather than stripped with patterns, so the leading
// licence comment falls outside the slice and nothing has to be "sanitised".
const logo = readFileSync(join(root, 'src/assets/logo.svg'), 'utf8');
const mark = logo.slice(logo.indexOf('>', logo.indexOf('<svg')) + 1, logo.lastIndexOf('</svg>'));

const FONT = "'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

for (const [lang, card] of Object.entries(CARDS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14101f"/>
      <stop offset="1" stop-color="#2a1a52"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <clipPath id="round"><rect width="256" height="256" rx="48"/></clipPath>
  <g transform="translate(88 96) scale(0.5)"><g clip-path="url(#round)">${mark}</g></g>
  <text x="248" y="188" font-family="${FONT}" font-size="46" font-weight="700" fill="#ffffff">Silence<tspan fill="#bc95fc" font-weight="500">Watch</tspan></text>
  <text x="88" y="340" font-family="${FONT}" font-size="56" font-weight="700" fill="#ffffff">${escape(card.title)}</text>
  <text x="88" y="418" font-family="${FONT}" font-size="36" fill="#d3bafe">${escape(card.lines[0])}</text>
  <text x="88" y="466" font-family="${FONT}" font-size="36" fill="#d3bafe">${escape(card.lines[1])}</text>
  <text x="88" y="560" font-family="${FONT}" font-size="26" fill="#98a2b3">${escape(card.foot)}</text>
  <text x="1112" y="560" font-family="${FONT}" font-size="26" fill="#bc95fc" text-anchor="end">silencewatch.com</text>
</svg>`;
  const target = join(root, `public/og/${lang}.png`);
  ensure(target);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(target);
}

console.log('site assets ready');

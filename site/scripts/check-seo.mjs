// What a search engine and a link preview will find in the built site, checked
// rather than hoped for. Run after `astro build`; exits non-zero on a defect.
//
// It reads the HTML in dist/ with patterns, not a parser: the markup is the
// site's own and regular, and a check that needs a dependency is a check that
// stops being run.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SITE = (process.env.SITE_URL ?? 'https://silencewatch.com').replace(/\/$/, '');

const TITLE_MAX = 65;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 165;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'pagefind' && name !== '_astro') walk(path);
    } else if (name === 'index.html') files.push(path);
  }
})(dist);

const problems = [];
const fail = (page, message) => problems.push(`${page}: ${message}`);

const urlOf = (file) => {
  const path = '/' + relative(dist, dirname(file)).split('\\').join('/');
  return path === '/.' || path === '/' ? '/' : `${path}/`;
};
const pages = new Map(files.map((file) => [urlOf(file), file]));
const titles = new Map();

const attr = (html, pattern) => html.match(pattern)?.[1];

for (const [url, file] of pages) {
  const html = readFileSync(file, 'utf8');
  const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'));

  const title = attr(head, /<title>([\s\S]*?)<\/title>/)?.trim();
  if (!title) fail(url, 'no <title>');
  else {
    if (title.length > TITLE_MAX) fail(url, `title is ${title.length} characters (max ${TITLE_MAX}): ${title}`);
    if (titles.has(title)) fail(url, `title duplicates ${titles.get(title)}: ${title}`);
    titles.set(title, url);
  }

  const description = attr(head, /<meta name="description" content="([^"]*)"/);
  if (!description) fail(url, 'no meta description');
  else if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    fail(url, `description is ${description.length} characters (${DESCRIPTION_MIN}–${DESCRIPTION_MAX})`);
  }

  const canonical = attr(head, /<link rel="canonical" href="([^"]*)"/);
  if (canonical !== `${SITE}${url}`) fail(url, `canonical is ${canonical}, expected ${SITE}${url}`);

  const h1 = [...html.matchAll(/<h1[\s>]/g)].length;
  if (h1 !== 1) fail(url, `${h1} <h1> elements, expected exactly one`);

  if (!/<html lang="(fr|en)"/.test(html)) fail(url, 'no lang on <html>');
  if (!/property="og:image" content="[^"]+\.png"/.test(head)) fail(url, 'no og:image');
  if (!/name="twitter:card"/.test(head)) fail(url, 'no twitter:card');

  // Every language alternate, including itself, plus x-default.
  const alternates = [...head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)];
  if (url !== '/404.html' && !url.startsWith('/404')) {
    const langs = alternates.map((m) => m[1]);
    for (const wanted of ['fr', 'en', 'x-default']) {
      if (!langs.includes(wanted)) fail(url, `no hreflang="${wanted}"`);
    }
    for (const [, , href] of alternates) {
      const path = href.replace(SITE, '');
      if (!pages.has(path)) fail(url, `hreflang points at a page that does not exist: ${href}`);
    }
    // English is the site's default language: x-default is its page, not the French one.
    const hrefOf = (lang) => alternates.find((m) => m[1] === lang)?.[2];
    if (hrefOf('x-default') !== hrefOf('en')) {
      fail(url, `hreflang x-default (${hrefOf('x-default')}) is not the English page (${hrefOf('en')})`);
    }
  }

  // Structured data has to be JSON, or it is silently ignored.
  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      fail(url, `invalid JSON-LD: ${error.message}`);
    }
  }

  // Images carry text for those who cannot see them.
  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(img[0])) fail(url, `<img> without alt: ${img[0].slice(0, 80)}`);
  }

  // Internal links resolve: a broken link is a crawl dead end and a bad first
  // impression in one.
  for (const link of html.matchAll(/<a\b[^>]*\shref="([^"#?]*)([^"]*)"/g)) {
    const href = link[1];
    if (!href || /^(https?:|mailto:|tel:)/.test(href)) continue;
    const target = href.startsWith('/') ? href : new URL(href, `${SITE}${url}`).pathname;
    if (/\.[a-z0-9]+$/i.test(target)) {
      if (!existsSync(join(dist, target))) fail(url, `link to a missing file: ${href}`);
    } else if (!pages.has(target.endsWith('/') ? target : `${target}/`)) {
      fail(url, `link to a missing page: ${href}`);
    }
  }
}

// Sitemap and robots.
const sitemapIndex = join(dist, 'sitemap-index.xml');
if (!existsSync(sitemapIndex)) fail('sitemap', 'sitemap-index.xml is missing');
else {
  const sitemap = readFileSync(join(dist, 'sitemap-0.xml'), 'utf8');
  for (const url of pages.keys()) {
    if (url.startsWith('/404')) continue;
    if (!sitemap.includes(`<loc>${SITE}${url}</loc>`)) fail('sitemap', `${url} is not in the sitemap`);
  }
}
if (!existsSync(join(dist, 'robots.txt'))) fail('robots', 'robots.txt is missing');
else if (!readFileSync(join(dist, 'robots.txt'), 'utf8').includes(`${SITE}/sitemap-index.xml`)) {
  fail('robots', 'robots.txt does not name the sitemap');
}
for (const image of ['og/fr.png', 'og/en.png', 'favicon.svg', 'lang-redirect.js']) {
  if (!existsSync(join(dist, image))) fail('assets', `${image} is missing`);
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `FAIL ${problem}`).join('\n'));
  console.error(`\n${problems.length} problem(s) in ${pages.size} pages.`);
  process.exit(1);
}
console.log(`${pages.size} pages checked: titles, descriptions, canonical, hreflang, structured data, links, sitemap.`);

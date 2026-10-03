# SilenceWatch site

The public website: showcase pages, user documentation and reference, in English
(at the root) and French (under `/fr/`). Astro and Starlight, static output.

```bash
pnpm install
pnpm run dev                       # http://localhost:4321
pnpm run build && node scripts/check-seo.mjs
```

It is a project of its own, outside the application's pnpm workspace. How it is
built, checked and shipped is in [docs/development.md](../docs/development.md#the-site)
and [docs/self-hosting.md](../docs/self-hosting.md).

- `src/content/docs/` — the pages. English at the top level, French in `fr/`,
  at the same path.
- `public/lang-redirect.js` — sends a browser set to French to `/fr/`, once, unless
  a language was chosen with the picker.
- `scripts/prepare.mjs` — copies the logo, generates the reference pages from
  `../docs/` and draws the sharing images. Its output is not committed.
- `scripts/check-seo.mjs` — what search engines will find, checked.

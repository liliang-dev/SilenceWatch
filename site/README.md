# SilenceWatch site

The public website: showcase pages, user documentation and reference, in French
(at the root) and English (under `/en/`). Astro and Starlight, static output.

```bash
pnpm install
pnpm run dev                       # http://localhost:4321
pnpm run build && node scripts/check-seo.mjs
```

It is a project of its own, outside the application's pnpm workspace. How it is
built, checked and shipped is in [docs/development.md](../docs/development.md#the-site)
and [docs/self-hosting.md](../docs/self-hosting.md).

- `src/content/docs/` — the pages. French at the top level, English in `en/`,
  at the same path.
- `scripts/prepare.mjs` — copies the logo, generates the reference pages from
  `../docs/` and draws the sharing images. Its output is not committed.
- `scripts/check-seo.mjs` — what search engines will find, checked.

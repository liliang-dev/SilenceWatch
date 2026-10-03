import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

/**
 * The address the site is served from. Canonical links, the sitemap, hreflang
 * and the social cards are all built from it, so it is stated once and the build
 * can be pointed elsewhere (a preview) without editing the file.
 */
const SITE = process.env.SITE_URL ?? 'https://silencewatch.com';

const REPOSITORY = 'https://github.com/liliang-dev/SilenceWatch';

export default defineConfig({
  site: SITE,
  // `/cron-monitoring/`, not `/cron-monitoring`: one address per page, so the
  // sitemap, the canonical link and the links between pages never disagree.
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    starlight({
      title: 'SilenceWatch',
      description:
        'Vos Jobs ne vous préviennent pas quand ils s’arrêtent. Nous oui. Monitoring de jobs par heartbeat, open source et auto-hébergeable.',
      // French is the language of the site and lives at the root; English is
      // under /en/. The root locale needs a `lang` because it is not 'root'.
      defaultLocale: 'root',
      locales: {
        root: { label: 'Français', lang: 'fr' },
        en: { label: 'English', lang: 'en' },
      },
      favicon: '/favicon.svg',
      logo: { src: './src/assets/logo.svg', alt: 'SilenceWatch' },
      social: [{ icon: 'github', label: 'GitHub', href: REPOSITORY }],
      customCss: ['./src/styles/brand.css'],
      lastUpdated: false,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      editLink: { baseUrl: `${REPOSITORY}/edit/dev/site/` },
      components: {
        Footer: './src/components/Footer.astro',
      },
      routeMiddleware: './src/route-middleware.ts',
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#8b4bf1' } },
        { tag: 'meta', attrs: { name: 'author', content: 'SilenceWatch' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
      ],
      sidebar: [
        {
          label: 'Documentation',
          translations: { en: 'Documentation' },
          items: [
            { slug: 'docs/getting-started' },
            { slug: 'docs/ping-api' },
            { slug: 'docs/cron-examples' },
            { slug: 'docs/schedules-and-states' },
            { slug: 'docs/alerting' },
            { slug: 'docs/spring-boot' },
          ],
        },
        {
          label: 'Référence',
          translations: { en: 'Reference' },
          items: [
            { slug: 'docs/reference/api' },
            { slug: 'docs/reference/self-hosting' },
            { slug: 'docs/reference/security' },
          ],
        },
      ],
    }),
  ],
});

import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { REPOSITORY, SITE } from './site';

/**
 * What every page says to a search engine or a link preview, beyond what
 * Starlight already writes (title, description, canonical, hreflang, Open Graph):
 *
 * - the sharing image, in the page's own language;
 * - structured data: the organisation and the software on the home page, an
 *   article for each documentation page, and the breadcrumb trail for every page
 *   below the home page.
 *
 * Kept in one place so what the site claims about itself cannot differ from page
 * to page.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const { lang, head, entry } = route;
  const path = context.url.pathname;
  const english = lang === 'en';
  const home = english ? '/en/' : '/';
  const url = (pathname: string) => `${SITE}${pathname}`;
  const title = entry.data.title;
  const description = entry.data.description;

  const image = url(`/og/${english ? 'en' : 'fr'}.png`);
  head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    {
      tag: 'meta',
      attrs: {
        property: 'og:image:alt',
        content: english
          ? 'SilenceWatch: job monitoring. Your jobs don’t tell you when they stop. We do.'
          : 'SilenceWatch : monitoring de jobs. Vos Jobs ne vous préviennent pas quand ils s’arrêtent. Nous oui.',
      },
    },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
  );

  // Starlight marks every page an article; the home page is the site.
  if (path === home) {
    for (const entryHead of head) {
      if (entryHead.tag === 'meta' && entryHead.attrs?.property === 'og:type') {
        entryHead.attrs.content = 'website';
      }
    }
  }

  const graph: Record<string, unknown>[] = [];

  if (path === home) {
    graph.push(
      {
        '@type': 'Organization',
        '@id': url('/#organization'),
        name: 'SilenceWatch',
        url: url('/'),
        logo: url('/favicon.svg'),
        sameAs: [REPOSITORY],
      },
      {
        '@type': 'WebSite',
        '@id': url('/#website'),
        url: url('/'),
        name: 'SilenceWatch',
        inLanguage: ['fr', 'en'],
        publisher: { '@id': url('/#organization') },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': url('/#software'),
        name: 'SilenceWatch',
        url: url(path),
        description,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web, Linux (Docker)',
        inLanguage: lang,
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        isAccessibleForFree: true,
        publisher: { '@id': url('/#organization') },
        featureList: english
          ? [
              'Cron and interval monitoring',
              'Heartbeat (dead man’s switch) endpoints',
              'Alerts by email, webhook, Slack, Microsoft Teams and Discord',
              'Spring Boot starter that discovers scheduled jobs',
              'REST API',
              'Self-hosting with Docker',
            ]
          : [
              'Monitoring de cron et d’intervalles',
              'Points d’entrée heartbeat (dead man’s switch)',
              'Alertes par e-mail, webhook, Slack, Microsoft Teams et Discord',
              'Starter Spring Boot qui découvre les jobs planifiés',
              'API REST',
              'Auto-hébergement avec Docker',
            ],
      },
    );
  } else {
    // Home › [Documentation ›] this page.
    const trail = [{ name: english ? 'Home' : 'Accueil', item: url(home) }];
    if (path.includes('/docs/') && !/\/docs\/$/.test(path)) {
      trail.push({
        name: 'Documentation',
        item: url(`${english ? '/en' : ''}/docs/getting-started/`),
      });
    }
    trail.push({ name: title, item: url(path) });
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((step, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: step.name,
        item: step.item,
      })),
    });

    if (path.includes('/docs/')) {
      graph.push({
        '@type': 'TechArticle',
        headline: title,
        description,
        inLanguage: lang,
        mainEntityOfPage: url(path),
        author: { '@type': 'Organization', name: 'SilenceWatch', url: url('/') },
        publisher: { '@type': 'Organization', name: 'SilenceWatch', url: url('/') },
      });
    }
  }

  head.push({
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    content: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }),
  });
});

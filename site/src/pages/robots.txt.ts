import type { APIRoute } from 'astro';

/**
 * Everything is open to crawlers, and the sitemap is named, built from the
 * address the site is actually served from (so a preview build does not point at
 * production).
 */
export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://silencewatch.com')).toString().replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${base}/sitemap-index.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};

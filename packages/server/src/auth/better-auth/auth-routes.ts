import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/config';
import { allowedAuthPaths } from './auth-paths';
import { enabledProviders } from './providers';
import { AUTH_BASE_PATH, CLIENT_IP_HEADER } from './auth-policy';
import { trustedOriginsOf, type Auth } from './auth.factory';

/**
 * Mounts Better Auth straight on Fastify, under /api/auth.
 *
 * Better Auth speaks the web `Request`/`Response` types and owns its own routing,
 * so it is handed the request whole instead of being wrapped in Nest controllers.
 * Doing it here also keeps the community Nest integration — one more dependency to
 * trust with every sign-in — out of the picture.
 *
 * Two things are done on the way in, and both matter:
 *  - the client address is written to a header of ours, replacing whatever the
 *    caller sent under that name, so rate limits and sign-up rules see the address
 *    Fastify resolved (honouring TRUST_PROXY) and not one the caller chose;
 *  - the URL is built from BASE_URL, never from the Host header.
 *
 * And one thing on the way through: a write that names an origin which is not one
 * of ours is refused. Better Auth checks the origin only when a cookie comes with
 * the request, which leaves a form on another site free to sign a visitor in to an
 * account of its own choosing; browsers always say where a write came from, so this
 * closes that, and costs a script that sends no Origin nothing.
 */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, config: AppConfig): void {
  const allowed = allowedAuthPaths(config.AUTH_MODE, enabledProviders(config));
  const origins = new Set(trustedOriginsOf(config));

  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const path = pathWithinAuth(request.url);
      if (!allowed.has(path) && !isProviderCallback(path, allowed)) {
        return reply.status(404).send({ statusCode: 404, error: 'NOT_FOUND', message: 'Not found' });
      }

      const origin = request.headers.origin;
      if (request.method !== 'GET' && origin !== undefined && !origins.has(origin)) {
        return reply
          .status(403)
          .send({ statusCode: 403, error: 'FORBIDDEN', message: 'Cross-origin request refused' });
      }

      const response = await auth.handler(toWebRequest(request, config));

      void reply.status(response.status);
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') void reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header('set-cookie', cookies);
      // Nothing under here is ever worth keeping: it is a session, or a challenge.
      void reply.header('cache-control', 'no-store');

      return reply.send(Buffer.from(await response.arrayBuffer()));
    },
  });
}

/** `/api/auth/sign-out?x=1` → `/sign-out` */
function pathWithinAuth(url: string): string {
  const path = url.split('?', 1)[0] ?? '';
  return path.slice(AUTH_BASE_PATH.length).replace(/\/+$/, '');
}

const isProviderCallback = (path: string, allowed: ReadonlySet<string>): boolean =>
  path.startsWith('/callback/') && allowed.has(path);

function toWebRequest(request: FastifyRequest, config: AppConfig): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === CLIENT_IP_HEADER) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set(CLIENT_IP_HEADER, request.ip);

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
    init.body = bodyOf(request, headers);
  }
  return new Request(new URL(request.url, config.baseUrl), init);
}

/** The body as the caller sent it, re-encoded: Fastify has already parsed it. */
function bodyOf(request: FastifyRequest, headers: Headers): string {
  const body = request.body;
  if (typeof body === 'string') return body;
  if ((headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(body as Record<string, string>).toString();
  }
  return JSON.stringify(body);
}

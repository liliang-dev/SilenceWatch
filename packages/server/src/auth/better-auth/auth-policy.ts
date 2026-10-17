import type { FastifyRequest } from 'fastify';

/** Where Better Auth is mounted. The web UI and every redirect URI depend on it. */
export const AUTH_BASE_PATH = '/api/auth';

/** A session lasts this long, and the clock restarts while it is used. */
export const SESSION_TTL_SECONDS = 30 * 86_400;
/** How stale a session may get before using it extends it again. */
export const SESSION_UPDATE_AGE_SECONDS = 86_400;
/**
 * How long after signing in an action that can lock someone out or cost money
 * (deleting the account, managing API keys, adding a passkey) is still allowed
 * without proving who is there again.
 */
export const FRESH_SESSION_SECONDS = 600;
/**
 * Sessions one account may keep signed in at once. Each browser or device holds
 * one, so this is generous; it exists so that signing in over and over is not a
 * way to make rows, and the oldest are the ones that go.
 */
export const MAX_LIVE_SESSIONS_PER_USER = 20;

/**
 * The header the server writes the client address into before handing a request
 * to Better Auth. It is overwritten on every request, so what a caller sends
 * under this name is never read: the address is Fastify's own, which honours
 * TRUST_PROXY, and every rate limit and sign-up rule depends on it being true.
 */
export const CLIENT_IP_HEADER = 'x-sw-client-ip';

/**
 * The cookie the web UI sets when a person arrives by a one-time setup link. A
 * cookie, not a header, because a sign-in through Google or Microsoft leaves the
 * page and comes back as a plain navigation, which carries cookies and nothing else.
 * It is only ever sent to the sign-in endpoints (see its Path), and holds the same
 * token the link did.
 */
export const SETUP_TOKEN_COOKIE = 'sw_setup';

/** Where a request came from, for the audit trail and the sign-up rules. */
export interface RequestOrigin {
  ip: string | null;
  userAgent: string | null;
}

/** The setup token a request carries, if any. */
export function setupTokenOfHeaders(headers: Headers | undefined | null): string | null {
  const cookies = headers?.get('cookie');
  if (cookies === undefined || cookies === null) return null;
  for (const part of cookies.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SETUP_TOKEN_COOKIE) return decodeURIComponent(value.join('=')) || null;
  }
  return null;
}

export function originOfHeaders(headers: Headers | undefined | null): RequestOrigin {
  const ip = headers?.get(CLIENT_IP_HEADER) ?? null;
  const userAgent = headers?.get('user-agent') ?? null;
  return { ip: ip === '' ? null : ip, userAgent: userAgent?.slice(0, 300) ?? null };
}

export function originOfRequest(request: FastifyRequest): RequestOrigin {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

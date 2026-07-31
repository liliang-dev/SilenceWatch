import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config';

export const REFRESH_COOKIE = 'sw_refresh';

/**
 * The refresh token as an HttpOnly cookie.
 *
 * Previously the browser kept it in `localStorage`, which any injected script
 * could read. The cookie cannot be read by script at all, which turns a
 * successful XSS from "walk away with a 30-day credential" into "act as the
 * user for as long as the page is open". That is a smaller loss, and it is the
 * whole reason for the change.
 *
 * The usual objection to cookies is CSRF, and `SameSite=Strict` answers it:
 * the browser will not attach this cookie to a request originating from another
 * site, so there is no cross-site request to forge. The path is narrowed to the
 * auth routes so it is not sent with every heartbeat page load either.
 *
 * Written by hand rather than with @fastify/cookie: one Set-Cookie header and
 * one header parse do not justify a plugin, and the attributes are the security
 * property here — they deserve to be visible in the file that sets them.
 */
export function setRefreshCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
): void {
  reply.header('set-cookie', serialise(token, config, config.REFRESH_TOKEN_TTL_DAYS * 86_400));
}

/** Clears it, with the same attributes — a mismatch leaves the old one in place. */
export function clearRefreshCookie(reply: FastifyReply, config: AppConfig): void {
  reply.header('set-cookie', serialise('', config, 0));
}

/**
 * Reads the token a client presented.
 *
 * The cookie wins, and the body is still accepted: the browser is not the only
 * client. A CLI or a mobile app has nowhere to put a cookie and holds the token
 * itself, and refusing them would be closing a door that XSS cannot walk
 * through anyway — a script that could set the body could not read the cookie
 * to put in it.
 */
export function readRefreshToken(
  request: FastifyRequest,
  body: { refreshToken?: string },
): string | null {
  return readCookie(request.headers.cookie, REFRESH_COOKIE) ?? body.refreshToken ?? null;
}

function serialise(value: string, config: AppConfig, maxAgeSeconds: number): string {
  const attributes = [
    `${REFRESH_COOKIE}=${value}`,
    // Not `/`: the token is only ever presented to the auth routes, so no other
    // request needs to carry it.
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];

  // A Secure cookie is dropped outright over plain http, which would break
  // local development; BASE_URL is what says whether this deployment is
  // reachable over TLS, and production already refuses to boot without it.
  if (config.baseUrl.startsWith('https://')) attributes.push('Secure');

  return attributes.join('; ');
}

/** Minimal cookie-header parse: exact name match, no decoding surprises. */
function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

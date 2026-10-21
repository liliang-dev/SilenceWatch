import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { FRESH_SESSION_SECONDS } from '../auth/better-auth/auth-policy';

/**
 * Who is calling. Two kinds only, and they are never interchangeable:
 *
 *  - `user`: a browser session, scoped to the projects the user belongs to;
 *  - `apiKey`: a machine credential, scoped to exactly one project.
 *
 * An API key can therefore never reach another project, and it can never perform
 * account operations (creating keys, changing a password) — those require a user.
 */
export type Principal =
  | { kind: 'user'; userId: string; sessionId: string; signedInAt: Date }
  | { kind: 'apiKey'; apiKeyId: string; projectId: string };

export interface AuthenticatedRequest extends FastifyRequest {
  principal?: Principal;
}

/** `@CurrentPrincipal() principal: Principal` */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      // Only reachable if a route escapes AuthGuard: fail closed.
      throw new UnauthorizedException('Authentication required');
    }
    return request.principal;
  },
);

export function assertUser(principal: Principal): { userId: string; sessionId: string } {
  if (principal.kind !== 'user') {
    throw new UnauthorizedException('This endpoint requires a user session, not an API key');
  }
  return { userId: principal.userId, sessionId: principal.sessionId };
}

/**
 * A user who signed in a moment ago, for what cannot be undone or hands out
 * access: deleting the account, creating or revoking an API key.
 *
 * A session lasts a month, so "signed in" proves little about who is at the
 * keyboard now; this asks for the sign-in itself to be recent. The refusal says so
 * in `details`, which is how the web UI knows to offer signing in again rather
 * than to report an error.
 */
export function assertRecentUser(principal: Principal): { userId: string; sessionId: string } {
  const user = assertUser(principal);
  if (principal.kind === 'user' && Date.now() - principal.signedInAt.getTime() >= FRESH_SESSION_SECONDS * 1000) {
    throw new ForbiddenException({
      message: 'Sign in again to do this.',
      details: { reauthRequired: true },
    });
  }
  return user;
}

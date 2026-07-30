import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

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
  | { kind: 'user'; userId: string; sessionId: string }
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

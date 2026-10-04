import type { FastifyRequest } from 'fastify';

/** Where a request came from, kept with the sessions and audit entries it produces. */
export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}

export function sessionContextOf(request: FastifyRequest): SessionContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

/** The identity an audit entry records for an authenticated user acting in a request. */
export function auditActorOf(
  user: { id: string; email: string },
  context: SessionContext,
): { userId: string; email: string; ip: string | null; userAgent: string | null } {
  return { userId: user.id, email: user.email, ip: context.ip, userAgent: context.userAgent };
}

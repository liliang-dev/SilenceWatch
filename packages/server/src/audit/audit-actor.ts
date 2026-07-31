import type { FastifyRequest } from 'fastify';
import type { Principal } from '../auth/principal';
import type { AuditActor } from './audit.service';

/**
 * Turns the authenticated principal and the request into an audit actor.
 *
 * Both kinds of principal are represented: a person acting in a browser and a
 * machine holding an API key produce different entries, and telling them apart
 * is usually the first question asked of an audit trail.
 */
export function auditActor(principal: Principal, request: FastifyRequest): AuditActor {
  const userAgent = request.headers['user-agent'];
  const base = {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };

  return principal.kind === 'apiKey'
    ? { ...base, apiKeyId: principal.apiKeyId }
    : { ...base, userId: principal.userId };
}

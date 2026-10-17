import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { ApiKeyService } from '../api-keys/api-key.service';
import { trustedOriginsOf } from '../auth/better-auth/auth.factory';
import { SessionResolver } from '../auth/better-auth/auth.provider';
import { AppConfig, CONFIG } from '../config/config';
import type { AuthenticatedRequest, Principal } from './principal';

const IS_PUBLIC = 'silencewatch:public';

/** Methods that change something, and so must not be triggerable from another site. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Marks a route as reachable without credentials. Everything else is closed:
 * this guard is global, so forgetting an annotation denies access rather than
 * exposing an endpoint.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Resolves who is calling into a Principal.
 *
 * Two kinds of credential, told apart by where they arrive: an `sw_…` key in
 * `Authorization: Bearer` is a machine, and the session cookie is a browser. The
 * resulting Principal carries the scope the rest of the application enforces.
 *
 * Note that the ingestion routes never reach this guard — they are registered
 * directly on Fastify, outside the Nest pipeline.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly origins: ReadonlySet<string>;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
    private readonly apiKeys: ApiKeyService,
  ) {
    this.origins = new Set(trustedOriginsOf(config));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.headers.authorization);

    request.principal =
      token === null
        ? await this.resolveSession(request, http.getResponse<FastifyReply>())
        : await this.resolveApiKey(token);
    return true;
  }

  private async resolveApiKey(token: string): Promise<Principal> {
    const resolved = token.startsWith('sw_') ? await this.apiKeys.resolve(token) : null;
    if (resolved === null) throw new UnauthorizedException('Invalid API key');
    return { kind: 'apiKey', apiKeyId: resolved.apiKeyId, projectId: resolved.projectId };
  }

  private async resolveSession(request: AuthenticatedRequest, reply: FastifyReply): Promise<Principal> {
    const session = await this.sessions.resolve(request.headers);
    if (session === null) throw new UnauthorizedException('Authentication required');

    // A cookie is sent by the browser whatever page asked for the request, which
    // is what makes it forgeable from another site. SameSite=Lax already withholds
    // it from cross-site writes; this refuses the ones that arrive anyway (a
    // sibling subdomain, an old browser), and costs nothing to a client that is
    // really our page, because browsers always say where a write came from.
    if (UNSAFE_METHODS.has(request.method) && !this.origins.has(request.headers.origin ?? '')) {
      throw new ForbiddenException('Cross-origin request refused');
    }

    if (session.setCookies.length > 0) void reply.header('set-cookie', session.setCookies);
    return {
      kind: 'user',
      userId: session.userId,
      sessionId: session.sessionId,
      signedInAt: session.signedInAt,
    };
  }
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer +(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

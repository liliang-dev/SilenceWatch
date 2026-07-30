import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from './api-key.service';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest, Principal } from './principal';
import { TokenService } from './token.service';

const IS_PUBLIC = 'silencewatch:public';

/**
 * Marks a route as reachable without credentials. Everything else is closed:
 * this guard is global, so forgetting an annotation denies access rather than
 * exposing an endpoint.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Resolves `Authorization: Bearer …` into a Principal.
 *
 * Both credential kinds share one header: a JWT for browser sessions, an
 * `sw_…` key for machines. The token shape decides which path is taken, and the
 * resulting Principal carries the scope the rest of the application enforces.
 *
 * Note that the ingestion routes never reach this guard — they are registered
 * directly on Fastify, outside the Nest pipeline.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.headers.authorization);
    if (token === null) throw new UnauthorizedException('Missing bearer token');

    request.principal = await this.resolve(token);
    return true;
  }

  private async resolve(token: string): Promise<Principal> {
    if (token.startsWith('sw_')) {
      const resolved = await this.apiKeys.resolve(token);
      if (resolved === null) throw new UnauthorizedException('Invalid API key');
      return { kind: 'apiKey', apiKeyId: resolved.apiKeyId, projectId: resolved.projectId };
    }

    const claims = await this.tokens.verifyAccessToken(token);
    if (claims === null) throw new UnauthorizedException('Invalid or expired access token');

    // The token is signed and unexpired, but the session may have been revoked
    // (logout, password change, token theft). One primary-key lookup buys
    // immediate revocation, which is worth more here than saving a round trip.
    if (!(await this.auth.isSessionActive(claims.sessionId))) {
      throw new UnauthorizedException('Session is no longer active');
    }

    return { kind: 'user', userId: claims.userId, sessionId: claims.sessionId };
  }
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer +(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

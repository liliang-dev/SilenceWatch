import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { AppConfig, CONFIG } from '../config/config';
import { RateLimiter } from './rate-limiter';

const STRICT = 'silencewatch:strict-rate-limit';

/**
 * Applies the tight budget (AUTH_RATE_LIMIT_PER_MINUTE) instead of the general
 * one. Used on credential endpoints, where the cost of an attempt must be high.
 */
export const StrictRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(STRICT, true);

/**
 * Per-client rate limiting for the API surface. Keyed by IP, because these are
 * the endpoints where the caller may not be authenticated yet — which is exactly
 * when limits matter (credential stuffing, sign-up floods).
 *
 * Heartbeat ingestion has its own per-ping-key limiter; it never comes through
 * here.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly general: RateLimiter;
  private readonly strict: RateLimiter;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly reflector: Reflector,
  ) {
    this.general = new RateLimiter(config.API_RATE_LIMIT_PER_MINUTE, 60_000);
    this.strict = new RateLimiter(config.AUTH_RATE_LIMIT_PER_MINUTE, 60_000, 20_000);
  }

  canActivate(context: ExecutionContext): boolean {
    const isStrict =
      this.reflector.getAllAndOverride<boolean>(STRICT, [context.getHandler(), context.getClass()]) ===
      true;

    const http = context.switchToHttp();
    const request = http.getRequest<{ ip?: string; url?: string }>();
    const limiter = isStrict ? this.strict : this.general;
    // Strict buckets are per route *and* per IP, so hammering /login does not
    // consume the budget for /refresh.
    const key = isStrict ? `${request.ip ?? 'unknown'}:${request.url ?? ''}` : (request.ip ?? 'unknown');

    const retryAfter = limiter.hit(key);
    if (retryAfter === 0) return true;

    void http.getResponse<FastifyReply>().header('retry-after', String(retryAfter));
    throw new HttpException(
      { message: 'Too many requests', details: { retryAfterSeconds: retryAfter } },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

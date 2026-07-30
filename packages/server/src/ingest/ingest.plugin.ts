import { Logger } from '@nestjs/common';
import type { PingKind } from '@silencewatch/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config';
import type { IngestOutcome, IngestService } from './ingest.service';

/**
 * Heartbeat routes, registered straight on Fastify instead of as a Nest
 * controller.
 *
 * This is deliberate: the ingestion path must not traverse the Nest request
 * pipeline (guards, pipes, interceptors, serialisers), and it must not inherit
 * the JSON body parser — a heartbeat may carry arbitrary text. Registering
 * inside an encapsulated plugin scope keeps the body parser and hooks local to
 * `/p/*` and leaves the rest of the application untouched.
 *
 * Accepted, because people put `curl` in a crontab:
 *   GET|POST /p/:pingKey            success
 *   GET|POST /p/:pingKey/start      run started
 *   GET|POST /p/:pingKey/fail       explicit failure
 *   GET|POST /p/:pingKey/:exitCode  exit code (0 = success, anything else fails)
 * Optional `?duration_ms=` reports execution time when the client measures it
 * itself instead of sending /start.
 */

interface PingParams {
  pingKey: string;
  exitCode?: string;
}

const TEXT_PLAIN = 'text/plain; charset=utf-8';
const MAX_EXIT_CODE = 255;

export async function registerIngestRoutes(
  app: FastifyInstance,
  service: IngestService,
  config: AppConfig,
): Promise<void> {
  const logger = new Logger('Ingest');
  // Room to accept a chatty job's output and truncate it ourselves rather than
  // answering 413 to a heartbeat.
  const bodyLimit = Math.max(65_536, config.PING_BODY_MAX_BYTES * 4);

  await app.register(
    async (scope: FastifyInstance) => {
      // Within this scope only: every content type arrives as a raw Buffer.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser<Buffer>(
        '*',
        { parseAs: 'buffer', bodyLimit },
        (_request, body, done) => done(null, body),
      );

      const handle =
        (resolveKind: (params: PingParams) => PingKind | null) =>
        async (request: FastifyRequest<{ Params: PingParams }>, reply: FastifyReply): Promise<void> => {
          const kind = resolveKind(request.params);
          if (kind === null) {
            respond(reply, 400, 'BAD REQUEST');
            return;
          }

          let outcome: IngestOutcome;
          try {
            outcome = await service.ingest({
              pingKey: request.params.pingKey,
              kind,
              exitCode: parseExitCode(request.params.exitCode),
              durationMs: parseDurationMs(request.query),
              body: Buffer.isBuffer(request.body) ? request.body : null,
              ip: request.ip ?? null,
              userAgent: headerValue(request.headers['user-agent']),
            });
          } catch (error) {
            // The database is unreachable or overloaded. Say so honestly with a
            // 503 so clients (and the starter) can retry, and never leak detail.
            logger.error(`Heartbeat write failed: ${(error as Error).message}`);
            respond(reply, 503, 'UNAVAILABLE');
            return;
          }

          switch (outcome) {
            case 'recorded':
              respond(reply, 200, 'OK');
              return;
            case 'paused':
              respond(reply, 200, 'PAUSED');
              return;
            case 'unknown':
              respond(reply, 404, 'NOT FOUND');
              return;
            case 'rate_limited':
              void reply.header('retry-after', '60');
              respond(reply, 429, 'RATE LIMITED');
              return;
            case 'invalid':
              respond(reply, 400, 'BAD REQUEST');
              return;
          }
        };

      const routeOptions = { bodyLimit };

      scope.route({
        method: ['GET', 'POST'],
        url: '/:pingKey',
        ...routeOptions,
        handler: handle(() => 'success'),
      });

      scope.route({
        method: ['GET', 'POST'],
        url: '/:pingKey/start',
        ...routeOptions,
        handler: handle(() => 'start'),
      });

      scope.route({
        method: ['GET', 'POST'],
        url: '/:pingKey/fail',
        ...routeOptions,
        handler: handle(() => 'fail'),
      });

      // Static segments win over parameters in Fastify's router, so /start and
      // /fail above are never shadowed by this route.
      scope.route({
        method: ['GET', 'POST'],
        url: '/:pingKey/:exitCode',
        ...routeOptions,
        handler: handle((params) => {
          const exitCode = parseExitCode(params.exitCode);
          return exitCode === null ? null : exitCode === 0 ? 'success' : 'fail';
        }),
      });
    },
    { prefix: '/p' },
  );
}

function respond(reply: FastifyReply, status: number, body: string): void {
  void reply.status(status).header('cache-control', 'no-store').type(TEXT_PLAIN).send(body);
}

function parseExitCode(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_EXIT_CODE ? value : null;
}

function parseDurationMs(query: unknown): number | null {
  if (query === null || typeof query !== 'object') return null;
  const raw = (query as Record<string, unknown>).duration_ms;
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) return null;
  return Number(raw);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

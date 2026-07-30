import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody } from '@silencewatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

/**
 * Single exit point for API errors: clients always get the same shape, and
 * unexpected failures are logged server-side with a correlation id while the
 * response stays free of stack traces, SQL and internal identifiers.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body: ApiErrorBody = {
        statusCode: status,
        error: HttpStatus[status] ?? 'ERROR',
        ...normaliseHttpPayload(payload),
      };

      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`${request.method} ${request.url} -> ${status}`, exception.stack);
      }
      void reply.status(status).send(body);
      return;
    }

    // Anything reaching here is a bug: log everything, disclose nothing.
    const requestId = randomUUID();
    this.logger.error(
      `Unhandled error ${requestId} on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    const body: ApiErrorBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId,
    };
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(body);
  }
}

function normaliseHttpPayload(payload: unknown): { message: string; details?: unknown } {
  if (typeof payload === 'string') return { message: payload };

  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const message =
      typeof record.message === 'string'
        ? record.message
        : Array.isArray(record.message)
          ? record.message.join(', ')
          : 'Request failed';
    return record.details === undefined ? { message } : { message, details: record.details };
  }

  return { message: 'Request failed' };
}

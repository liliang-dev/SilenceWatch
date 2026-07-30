import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates and *narrows* request payloads with the schemas shared with the web
 * UI and the client libraries, so a rule can never drift between the two.
 *
 * Used explicitly at each parameter rather than globally: the ingestion path
 * must stay free of the Nest pipeline, and an explicit pipe makes the contract
 * of each handler visible where it is declared.
 */
export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Only field paths and messages are exposed — never the received value,
    // which may hold a password or a token.
    throw new BadRequestException({
      message: 'Validation failed',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

/** `@Body(zodPipe(createCheckRequestSchema))` */
export function zodPipe<TSchema extends ZodTypeAny>(schema: TSchema): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}

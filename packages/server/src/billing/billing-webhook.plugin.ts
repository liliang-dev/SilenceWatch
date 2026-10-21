import { Logger } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config';
import type { BillingService } from './billing.service';
import type { StripeEvent } from './stripe-events';
import { verifyStripeSignature } from './stripe-signature';

const MAX_BODY_BYTES = 262_144;

/**
 * Stripe's webhook, registered straight on Fastify like the heartbeat routes.
 *
 * It has to be: the signature is over the bytes as they arrived, so the body
 * must reach the handler unparsed, and a global JSON parser would have turned it
 * into an object by then. Inside an encapsulated scope the raw-body parser is
 * local to this one route and the rest of the API is untouched.
 *
 * It sits outside the guards, so authentication here is the signature and
 * nothing else: no valid signature, no effect — and no work beyond one HMAC.
 */
export async function registerBillingWebhook(
  app: FastifyInstance,
  billing: BillingService,
  config: AppConfig,
): Promise<void> {
  if (!config.BILLING_ENABLED) return;

  const logger = new Logger('BillingWebhook');
  const secret = config.STRIPE_WEBHOOK_SECRET as string;

  await app.register(async (scope: FastifyInstance) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser<Buffer>(
      '*',
      { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES },
      (_request, body, done) => done(null, body),
    );

    scope.post(
      '/api/v1/billing/webhook',
      { bodyLimit: MAX_BODY_BYTES },
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const body = request.body;
        const header = request.headers['stripe-signature'];
        if (
          !Buffer.isBuffer(body) ||
          !verifyStripeSignature(body, typeof header === 'string' ? header : undefined, secret)
        ) {
          // Nothing about why: a caller guessing at the secret learns nothing.
          void reply.code(400).send({ statusCode: 400, message: 'Invalid signature' });
          return;
        }

        let event: StripeEvent;
        try {
          event = JSON.parse(body.toString('utf8')) as StripeEvent;
          if (typeof event.id !== 'string' || typeof event.type !== 'string') throw new Error('shape');
        } catch {
          void reply.code(400).send({ statusCode: 400, message: 'Invalid event' });
          return;
        }

        try {
          const outcome = await billing.handleEvent(event);
          logger.debug(`${event.type} ${event.id}: ${outcome.kind}`);
          void reply.code(200).send({ received: true });
        } catch (error) {
          // A failure to record it: say so, and Stripe delivers it again.
          logger.error(`Could not apply ${event.type} ${event.id}: ${String(error)}`);
          void reply.code(500).send({ statusCode: 500, message: 'Could not apply the event' });
        }
      },
    );
  });
}

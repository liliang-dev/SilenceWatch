import { Logger } from '@nestjs/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config';

/**
 * Reports when `TRUST_PROXY` disagrees with reality.
 *
 * This setting decides where the client address comes from, and everything
 * keyed on that address — per-IP rate limiting, the sign-up velocity rule, the
 * addresses in the audit trail — is only as good as the answer. Both ways of
 * getting it wrong are silent:
 *
 *  - **Trusting a proxy that is not there.** Anything that can reach the server
 *    directly sets `X-Forwarded-For` to whatever it likes and inherits a clean
 *    slate on every limit.
 *  - **Not trusting a proxy that is.** Every request appears to come from the
 *    proxy, so one shared bucket throttles the entire internet as if it were a
 *    single visitor, and the audit trail records the load balancer.
 *
 * Neither shows up as an error. What the server *can* do is watch whether the
 * header it was told to expect actually turns up, and say so — once, loudly,
 * with the fix in the message.
 */
export function registerProxyTrustCheck(app: FastifyInstance, config: AppConfig): void {
  const logger = new Logger('ProxyTrust');
  const trusting = config.TRUST_PROXY !== false && config.TRUST_PROXY !== '';

  let sampled = 0;
  let withHeader = 0;
  let reported = false;

  // A first request is not evidence: a health probe from inside the network
  // legitimately arrives without the header even behind a proxy. Judge on a
  // sample, then stop looking.
  const SAMPLE = 20;

  app.addHook('onRequest', (request: FastifyRequest, _reply, done) => {
    if (reported) {
      done();
      return;
    }

    sampled += 1;
    if (request.headers['x-forwarded-for'] !== undefined) withHeader += 1;

    if (sampled >= SAMPLE) {
      reported = true;

      if (trusting && withHeader === 0) {
        logger.error(
          `TRUST_PROXY is set but none of the last ${SAMPLE} requests carried X-Forwarded-For. ` +
            'If nothing is proxying this server, every per-IP limit can be bypassed by sending ' +
            'that header. Set TRUST_PROXY=false, or narrow it to your proxy address.',
        );
      } else if (!trusting && withHeader === sampled) {
        logger.warn(
          `TRUST_PROXY is off but every one of the last ${SAMPLE} requests carried ` +
            'X-Forwarded-For. Rate limits are counting your proxy as one client, and the audit ' +
            'trail is recording its address instead of your users. Set TRUST_PROXY to the ' +
            "proxy's address or CIDR.",
        );
      }
    }

    done();
  });

  if (trusting && config.TRUST_PROXY === true) {
    logger.warn(
      'TRUST_PROXY=true trusts the hop count from anyone who can reach this server. ' +
        'Prefer naming the proxy (TRUST_PROXY=10.0.0.0/8) so a direct connection cannot claim ' +
        'to be a forwarded one.',
    );
  }
}

import { z } from 'zod';
import { booleanish, csv, port } from '../env-helpers';

/** How the server is reached. */
export const httpShape = {
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: port.default(8080),
  /** Public origin, used in ping URLs and alert links. */
  BASE_URL: z.string().url().default('http://localhost:8080'),
  /** Extra browser origins allowed to call the API (the web UI is same-origin). */
  CORS_ORIGINS: csv.prefault(''),
  /**
   * Set when running behind a reverse proxy so client IPs come from
   * X-Forwarded-For. Leave false when directly exposed: a spoofed header
   * would otherwise defeat per-IP rate limiting.
   */
  /**
   * `prefault`, not `default`, and the distinction is not cosmetic. In zod 4
   * `.default()` hands back the literal value without parsing it, so
   * `.default('false')` on this union produced the *string* `"false"` — which
   * type-checks, because the union admits strings, and which fastify then
   * tried to read as a CIDR: "invalid IP address: false". `prefault` feeds
   * the value through the union, so an unset variable still resolves to the
   * boolean `false` it did before.
   */
  TRUST_PROXY: z.union([booleanish, z.string().min(1)]).prefault('false'),
  /** Serve the compiled Angular UI from the same process. */
  SERVE_WEB: booleanish.prefault('true'),
};

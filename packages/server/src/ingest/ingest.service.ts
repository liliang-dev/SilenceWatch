import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PingKind } from '@silencewatch/shared';
import { AppConfig, CONFIG } from '../config/config';
import { PgService } from '../database/pg.service';
import { RateLimiter } from '../common/rate-limiter';
import { computeNextDueAt, InvalidScheduleError } from '../schedule/next-due';
import { CheckMetadataCache } from './check-metadata.cache';

/**
 * Single statement, single round trip:
 *   - `prev` snapshots the values needed to derive a duration before the update;
 *   - `upd` performs the one UPDATE (state, deadlines, duration);
 *   - the INSERT records the ping, but only if the UPDATE matched — a paused
 *     check silently records nothing.
 *
 * `WHERE state <> 'PAUSED'` lives in SQL rather than in application code so a
 * paused check cannot be revived by a race between cache and write.
 */
const INGEST_SQL = `
WITH prev AS (
    SELECT id, last_started_at
      FROM "check"
     WHERE ping_key = $1::uuid
       AND state <> 'PAUSED'
), measured AS (
    -- The duration of *this* run: reported by the client, or derived from a
    -- previous /start. Never inherited from an earlier run.
    SELECT prev.id,
           CASE
               WHEN $3::ping_kind = 'start' THEN NULL
               WHEN $5::int IS NOT NULL THEN $5::int
               WHEN prev.last_started_at IS NOT NULL THEN
                   LEAST(
                       2147483647,
                       GREATEST(0, (EXTRACT(EPOCH FROM ($2::timestamptz - prev.last_started_at)) * 1000)::bigint)
                   )::int
               ELSE NULL
           END AS duration_ms
      FROM prev
), upd AS (
    UPDATE "check" c SET
        last_ping_at    = CASE WHEN $3::ping_kind = 'start' THEN c.last_ping_at ELSE $2::timestamptz END,
        last_started_at = CASE WHEN $3::ping_kind = 'start' THEN $2::timestamptz ELSE NULL END,
        next_due_at     = CASE WHEN $3::ping_kind = 'start' THEN c.next_due_at ELSE $6::timestamptz END,
        state           = CASE WHEN $3::ping_kind = 'start' THEN c.state
                               WHEN $3::ping_kind = 'fail'  THEN 'DOWN'::check_state
                               ELSE 'UP'::check_state END,
        -- Keep the last known duration when this ping did not measure one.
        last_duration_ms = COALESCE(m.duration_ms, c.last_duration_ms)
      FROM measured m
     WHERE c.id = m.id
    RETURNING c.id, m.duration_ms
)
INSERT INTO ping (check_id, received_at, kind, exit_code, duration_ms, body, source_ip, user_agent)
SELECT upd.id,
       $2::timestamptz,
       $3::ping_kind,
       $4::int,
       upd.duration_ms,
       $7::text,
       $8::inet,
       $9::text
  FROM upd
RETURNING check_id`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_USER_AGENT_LENGTH = 300;
const INT32_MAX = 2_147_483_647;

export interface IngestCommand {
  pingKey: string;
  kind: PingKind;
  exitCode: number | null;
  durationMs: number | null;
  body: Buffer | null;
  ip: string | null;
  userAgent: string | null;
}

export type IngestOutcome = 'recorded' | 'paused' | 'unknown' | 'rate_limited' | 'invalid';

/**
 * The path that must never fall over. No Prisma, no validation pipes, no guards,
 * no interceptors, no outbound call, no business logic — a Map lookup and one
 * write. Recovery alerting is intentionally *not* done here: the detection loop
 * reconciles state changes a few seconds later, which keeps this path flat.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly perKeyLimiter: RateLimiter;
  /** Separate budget for unknown keys, so URL scanning cannot cost us anything. */
  private readonly unknownKeyLimiter: RateLimiter;
  private readonly maxBodyBytes: number;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly pg: PgService,
    private readonly cache: CheckMetadataCache,
  ) {
    this.perKeyLimiter = new RateLimiter(config.PING_RATE_LIMIT_PER_MINUTE, 60_000);
    this.unknownKeyLimiter = new RateLimiter(60, 60_000, 20_000);
    this.maxBodyBytes = config.PING_BODY_MAX_BYTES;
  }

  async ingest(command: IngestCommand): Promise<IngestOutcome> {
    if (!UUID_PATTERN.test(command.pingKey)) return 'invalid';

    const pingKey = command.pingKey.toLowerCase();
    if (this.perKeyLimiter.hit(pingKey) > 0) return 'rate_limited';

    // Walking the URL space costs one database round trip per *fresh* key: the
    // negative cache only helps against a key asked for twice, and a scanner
    // never asks twice. Nothing else bounds it — `/p/*` bypasses the Nest
    // pipeline, so the per-IP API limiter never sees these requests, and the
    // per-key limiter above is useless against a caller that never repeats a
    // key. So the budget is charged once a lookup has proved wasted, and a
    // source that has spent it stops being given lookups.
    //
    // The refusal is 429 and never 404. Answering "no such check" to a key we
    // did not look up would be a lie about the one thing this path exists to
    // report: a valid heartbeat told it is calling the wrong URL is a job that
    // looks silent, and silence is what this product turns into an alarm. A
    // throttled client is told to come back, and does.
    const source = command.ip ?? 'unknown';
    if (this.unknownKeyLimiter.exceeded(source)) return 'rate_limited';

    const metadata = await this.cache.get(pingKey);
    if (metadata === null) {
      this.unknownKeyLimiter.hit(source);
      return 'unknown';
    }

    const receivedAt = new Date();
    let nextDueAt: Date | null = null;
    if (command.kind !== 'start') {
      try {
        nextDueAt = computeNextDueAt(metadata, receivedAt);
      } catch (error) {
        // Constraints and write-path validation make this unreachable; if it
        // ever happens, record the ping rather than lose the heartbeat.
        if (!(error instanceof InvalidScheduleError)) throw error;
        this.logger.error(`Check ${metadata.id} has an unusable schedule: ${error.message}`);
      }
    }

    const result = await this.pg.query<{ check_id: string }>({
      name: 'ingest_ping',
      text: INGEST_SQL,
      values: [
        pingKey,
        receivedAt,
        command.kind,
        clampInt(command.exitCode),
        clampInt(command.durationMs, 0),
        nextDueAt,
        this.truncateBody(command.body),
        normaliseIp(command.ip),
        truncate(command.userAgent, MAX_USER_AGENT_LENGTH),
      ],
    });

    return result.rowCount === 0 ? 'paused' : 'recorded';
  }

  /**
   * Keeps only the first bytes of the payload and strips NUL, which PostgreSQL
   * cannot store in a text column.
   */
  private truncateBody(body: Buffer | null): string | null {
    if (body === null || body.length === 0 || this.maxBodyBytes === 0) return null;
    const slice = body.length > this.maxBodyBytes ? body.subarray(0, this.maxBodyBytes) : body;
    const text = slice.toString('utf8').replace(/\u0000/g, '');
    return text.length === 0 ? null : text;
  }
}

function clampInt(value: number | null, min = -INT32_MAX): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(INT32_MAX, Math.max(min, Math.trunc(value)));
}

function truncate(value: string | null, max: number): string | null {
  if (value === null || value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * The `inet` column rejects malformed input, and a rejected insert would turn a
 * cosmetic problem into a lost heartbeat — so anything unusual becomes NULL.
 */
function normaliseIp(ip: string | null): string | null {
  if (ip === null) return null;
  const withoutZone = ip.split('%')[0] ?? '';
  if (withoutZone.length === 0 || withoutZone.length > 45) return null;
  return /^[0-9a-fA-F:.]+$/.test(withoutZone) ? withoutZone : null;
}

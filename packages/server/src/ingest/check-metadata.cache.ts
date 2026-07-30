import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CHECK_CHANGED_CHANNEL, PgListenerService } from '../database/pg-listener.service';
import { PgService } from '../database/pg.service';
import type { Schedule } from '../schedule/next-due';

/** Everything ingestion needs to know about a check, and nothing more. */
export interface CheckMetadata extends Schedule {
  id: string;
}

interface CacheEntry {
  metadata: CheckMetadata | null;
  expiresAt: number;
}

const LOOKUP_SQL = `
  SELECT id, schedule_type, period_seconds, cron_expression, timezone
    FROM "check"
   WHERE ping_key = $1`;

interface CheckRow {
  id: string;
  schedule_type: 'interval' | 'cron';
  period_seconds: number | null;
  cron_expression: string | null;
  timezone: string;
}

/**
 * Ingestion needs the schedule of a check to compute its next deadline, but it
 * must not pay for a read on every heartbeat. This cache turns the steady state
 * into a single Map lookup followed by a single write.
 *
 * Freshness comes from a PostgreSQL trigger that NOTIFYs on schedule changes and
 * deletions, so an edit takes effect on every instance within milliseconds. The
 * TTL is only a backstop for a dropped notification.
 *
 * Unknown ping keys are cached negatively for a few seconds: someone walking the
 * URL space cannot turn 404s into database load.
 */
@Injectable()
export class CheckMetadataCache implements OnModuleInit {
  private readonly logger = new Logger(CheckMetadataCache.name);
  private readonly entries = new Map<string, CacheEntry>();
  /** Coalesces concurrent misses on the same key into one query. */
  private readonly inFlight = new Map<string, Promise<CheckMetadata | null>>();

  private readonly positiveTtlMs = 300_000;
  private readonly negativeTtlMs = 5_000;
  private readonly maxEntries = 100_000;

  private hits = 0;
  private misses = 0;

  constructor(
    private readonly pg: PgService,
    private readonly listener: PgListenerService,
  ) {}

  onModuleInit(): void {
    this.listener.subscribe(CHECK_CHANGED_CHANNEL, (pingKey) => {
      this.entries.delete(pingKey);
      this.logger.debug(`Invalidated cached metadata for ${pingKey}`);
    });
  }

  async get(pingKey: string): Promise<CheckMetadata | null> {
    const now = Date.now();
    const entry = this.entries.get(pingKey);
    if (entry !== undefined && entry.expiresAt > now) {
      this.hits += 1;
      return entry.metadata;
    }

    this.misses += 1;
    const pending = this.inFlight.get(pingKey);
    if (pending !== undefined) return pending;

    const load = this.load(pingKey).finally(() => this.inFlight.delete(pingKey));
    this.inFlight.set(pingKey, load);
    return load;
  }

  /** Called by write paths so an edit is visible locally without waiting for NOTIFY. */
  invalidate(pingKey: string): void {
    this.entries.delete(pingKey);
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.entries.size, hits: this.hits, misses: this.misses };
  }

  private async load(pingKey: string): Promise<CheckMetadata | null> {
    const result = await this.pg.query<CheckRow>({
      name: 'ingest_lookup_check',
      text: LOOKUP_SQL,
      values: [pingKey],
    });

    const row = result.rows[0];
    const metadata: CheckMetadata | null =
      row === undefined
        ? null
        : {
            id: row.id,
            scheduleType: row.schedule_type,
            periodSeconds: row.period_seconds,
            cronExpression: row.cron_expression,
            timezone: row.timezone,
          };

    this.store(pingKey, metadata);
    return metadata;
  }

  private store(pingKey: string, metadata: CheckMetadata | null): void {
    if (this.entries.size >= this.maxEntries) this.evict();
    this.entries.set(pingKey, {
      metadata,
      expiresAt: Date.now() + (metadata === null ? this.negativeTtlMs : this.positiveTtlMs),
    });
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    if (this.entries.size < this.maxEntries) return;

    // Insertion-ordered iteration: drop the oldest tenth.
    const excess = Math.ceil(this.maxEntries / 10);
    let dropped = 0;
    for (const key of this.entries.keys()) {
      this.entries.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

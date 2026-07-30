import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { AppConfig, CONFIG } from '../config/config';

/**
 * Direct PostgreSQL access for the two paths where Prisma is the wrong tool:
 *
 *  - ingestion, which must be a single prepared statement with no ORM overhead;
 *  - queue claiming, which needs `FOR UPDATE SKIP LOCKED`.
 *
 * The pool is separate from Prisma's so that a burst of CRUD traffic can never
 * starve heartbeat ingestion of connections.
 */
@Injectable()
export class PgService implements OnModuleDestroy {
  private readonly logger = new Logger(PgService.name);
  private readonly pool: Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.INGEST_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // A heartbeat write that takes more than 5s is a lost cause: fail fast
      // rather than pile connections up behind a lock.
      statement_timeout: 5_000,
      query_timeout: 5_000,
      application_name: 'silencewatch-ingest',
    });

    // Idle-client failures (server restart, network blip) must never take the
    // process down; the pool replaces the client on the next acquisition.
    this.pool.on('error', (error) => {
      this.logger.warn(`Idle PostgreSQL client error: ${error.message}`);
    });
  }

  /**
   * Runs a query. Passing `name` makes it a server-side prepared statement,
   * which the ingestion path relies on to skip parse/plan per request.
   */
  async query<T extends QueryResultRow>(
    config: { name?: string; text: string; values?: unknown[] },
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(config as never);
  }

  /** Runs `work` inside a transaction, rolling back on any failure. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.warn(`Rollback failed: ${(rollbackError as Error).message}`);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Pool counters, surfaced by /health and the support bundle. */
  stats(): { total: number; idle: number; waiting: number } {
    return { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

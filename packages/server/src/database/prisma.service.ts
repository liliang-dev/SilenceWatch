import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config/config';

/**
 * Prisma serves CRUD, the REST API and migrations. It is intentionally absent
 * from the ingestion path (see IngestService) and from the queue claiming
 * queries, which need SQL that Prisma cannot express.
 *
 * Since Prisma 7 the connection is owned here rather than described in
 * schema.prisma: the client is handed a `pg` pool as a driver adapter. That
 * makes the pool an ordinary pg pool, configured the same way as the ingestion
 * one in PgService — and, unlike the URL parameters it replaces, it can be
 * given an error handler.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    // Bounded from configuration instead of the driver's default, which
    // silently exhausts PostgreSQL's max_connections when two instances run on
    // a large VPS. Under Prisma 6 this was the `connection_limit` URL
    // parameter, which the pg driver does not read.
    const pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Both ends of a query. The server cancels a statement that runs too long;
      // the client gives up a little after, which is the one that still works
      // when the connection is half-dead and the server can no longer say so.
      statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
      query_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS + 5_000,
      // A transaction left open by a request that went away would hold its locks
      // until someone noticed.
      idle_in_transaction_session_timeout: 60_000,
      // Probe idle sockets, so one the network dropped is found by the probe
      // rather than by the request that was unlucky enough to be handed it.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      application_name: 'silencewatch',
    });

    super({
      adapter: new PrismaPg(pool),
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });

    this.pool = pool;

    // Idle-client failures (server restart, network blip) must never take the
    // process down; the pool replaces the client on the next acquisition.
    this.pool.on('error', (error) => {
      this.logger.warn(`Idle PostgreSQL client error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    // The pool is ours rather than Prisma's, so closing it is ours too.
    await this.pool.end();
  }
}

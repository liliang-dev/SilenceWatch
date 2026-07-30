import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig, CONFIG } from '../config/config';

/**
 * Prisma serves CRUD, the REST API and migrations. It is intentionally absent
 * from the ingestion path (see IngestService) and from the queue claiming
 * queries, which need SQL that Prisma cannot express.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(CONFIG) config: AppConfig) {
    super({
      datasources: { db: { url: withPoolSettings(config.DATABASE_URL, config.DATABASE_POOL_MAX) } },
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Bounds the Prisma pool from configuration instead of letting it default to
 * `num_cpus * 2 + 1`, which silently exhausts PostgreSQL's max_connections when
 * two instances run on a large VPS.
 */
export function withPoolSettings(databaseUrl: string, poolMax: number): string {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.set('connection_limit', String(poolMax));
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
    if (!url.searchParams.has('application_name')) {
      url.searchParams.set('application_name', 'silencewatch');
    }
    return url.toString();
  } catch {
    // Unparseable URLs are left untouched; Prisma reports the real error.
    return databaseUrl;
  }
}

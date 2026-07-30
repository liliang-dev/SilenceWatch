import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/auth.guard';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { DetectionService } from '../detection/detection.service';
import { PgService } from '../database/pg.service';
import { PrismaService } from '../database/prisma.service';
import { CheckMetadataCache } from '../ingest/check-metadata.cache';
import { NotificationQueueService } from '../notifications/notification-queue.service';
import { SILENCEWATCH_VERSION } from '../version';

/**
 * `/health` is public and deliberately thin: enough for a load balancer, a
 * container orchestrator or an external watchdog to tell a working instance from
 * a broken one, and nothing an attacker can mine.
 *
 * The detailed view lives behind authentication.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pg: PgService,
    private readonly detection: DetectionService,
    private readonly notifications: NotificationQueueService,
    private readonly cache: CheckMetadataCache,
  ) {}

  @Public()
  @Get('health')
  async health(@Res() reply: FastifyReply): Promise<void> {
    const databaseUp = await this.isDatabaseUp();
    const detection = this.detection.health();
    // A stalled detection loop is a failed instance even though HTTP still works:
    // reporting healthy here would hide the only outage that really matters.
    const detectionHealthy =
      detection.lastSuccessAt !== null &&
      Date.now() - Date.parse(detection.lastSuccessAt) < detection.intervalMs * 6;

    const healthy = databaseUp && (detectionHealthy || detection.ticks === 0);
    void reply.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).send({
      status: healthy ? 'ok' : 'degraded',
      version: SILENCEWATCH_VERSION,
      database: databaseUp ? 'up' : 'down',
      detection: detectionHealthy ? 'running' : detection.ticks === 0 ? 'starting' : 'stalled',
      time: new Date().toISOString(),
    });
  }

  /** Full internals. Any authenticated principal may read this. */
  @Get('v1/status')
  async status(@CurrentPrincipal() principal: Principal): Promise<Record<string, unknown>> {
    return {
      version: SILENCEWATCH_VERSION,
      time: new Date().toISOString(),
      principal: principal.kind,
      database: { up: await this.isDatabaseUp(), ingestPool: this.pg.stats() },
      detection: this.detection.health(),
      notifications: this.notifications.health(),
      ingestCache: this.cache.stats(),
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
        nodeVersion: process.version,
      },
    };
  }

  private async isDatabaseUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

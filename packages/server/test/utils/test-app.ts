import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChannelType } from '@silencewatch/shared';
import { AppModule } from '../../src/app.module';
import { CONFIG, loadConfig, type AppConfig } from '../../src/config/config';
import { DetectionService } from '../../src/detection/detection.service';
import { PrismaService } from '../../src/database/prisma.service';
import { registerIngestRoutes } from '../../src/ingest/ingest.plugin';
import { IngestService } from '../../src/ingest/ingest.service';
import type { Alert } from '../../src/notifications/alert';
import { NotificationQueueService } from '../../src/notifications/notification-queue.service';
import { SenderRegistry } from '../../src/notifications/sender.registry';
import type { ChannelSender } from '../../src/notifications/senders/channel-sender';

export interface CapturedAlert {
  type: ChannelType;
  alert: Alert;
  config: unknown;
}

/**
 * Captures deliveries instead of sending them, and can be told to fail so the
 * retry path is testable. Replaces the real senders — the tests must never make
 * an outbound connection.
 */
export class RecordingSenderRegistry {
  readonly captured: CapturedAlert[] = [];
  failNext = 0;

  get(type: ChannelType): ChannelSender {
    return {
      type,
      send: async (alert: Alert, config: unknown): Promise<void> => {
        if (this.failNext > 0) {
          this.failNext -= 1;
          throw new Error('simulated channel failure');
        }
        this.captured.push({ type, alert, config });
      },
    };
  }

  clear(): void {
    this.captured.length = 0;
    this.failNext = 0;
  }
}

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaService;
  detection: DetectionService;
  notifications: NotificationQueueService;
  senders: RecordingSenderRegistry;
  config: AppConfig;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? (process.env.DATABASE_URL as string);

  // The loops are driven explicitly by the tests: a background tick would make
  // assertions racy.
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    SECRET_KEY: 'test-secret-key-that-is-long-enough',
    BASE_URL: 'http://test.silencewatch.local',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SERVE_WEB: 'false',
    DETECTION_ENABLED: 'false',
    // Deliberately smaller than some test backlogs, so the batching loop is
    // exercised rather than assumed.
    DETECTION_BATCH_SIZE: '5',
    NOTIFICATION_INTERVAL_MS: '600000',
    EMAIL_PROVIDER: 'console',
    API_RATE_LIMIT_PER_MINUTE: '100000',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    PING_RATE_LIMIT_PER_MINUTE: '100000',
  } as NodeJS.ProcessEnv);

  const senders = new RecordingSenderRegistry();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(SenderRegistry)
    .useValue(senders)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );

  await registerIngestRoutes(
    app.getHttpAdapter().getInstance() as never,
    app.get(IngestService),
    config,
  );
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService);

  const notifications = app.get(NotificationQueueService);

  const reset = async (): Promise<void> => {
    // TRUNCATE needs an exclusive lock on every table; a delivery pass left over
    // from the previous test would deadlock against it.
    await notifications.settle();
    await prisma.$executeRawUnsafe(
      'TRUNCATE "user", project, project_member, session, api_key, "check", ping, incident, ' +
        'notification_channel, notification_delivery RESTART IDENTITY CASCADE',
    );
    senders.clear();
  };

  await reset();

  return {
    app,
    prisma,
    detection: app.get(DetectionService),
    notifications,
    senders,
    config,
    reset,
    close: async (): Promise<void> => {
      await app.close();
    },
  };
}

/** Registers a user and returns its bearer token plus first project. */
export async function registerUser(
  context: TestApp,
  email = `user-${Math.random().toString(36).slice(2)}@example.test`,
): Promise<{ token: string; userId: string; projectId: string; email: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'a-sufficiently-long-password', name: 'Test' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  }

  const session = response.json<{ accessToken: string; user: { id: string } }>();
  const projects = await context.app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    headers: { authorization: `Bearer ${session.accessToken}` },
  });

  return {
    token: session.accessToken,
    userId: session.user.id,
    projectId: projects.json<Array<{ id: string }>>()[0]?.id as string,
    email,
  };
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

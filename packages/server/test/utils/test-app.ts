import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChannelType } from '@silencewatch/shared';
import { AppModule } from '../../src/app.module';
import { registerAuthRoutes } from '../../src/auth/better-auth/auth-routes';
import { createAuth, type Auth } from '../../src/auth/better-auth/auth.factory';
import { AUTH } from '../../src/auth/better-auth/auth.provider';
import { AuditService } from '../../src/audit/audit.service';
import { LoginLockoutService } from '../../src/auth/lockout/login-lockout.service';
import { RecoveryCodesService } from '../../src/auth/recovery/recovery-codes.service';
import { SignupPolicyService } from '../../src/auth/signup/signup-policy.service';
import { UsersRepository } from '../../src/auth/users/users.repository';
import type { BetterAuthOptions } from 'better-auth';
import { registerBillingWebhook } from '../../src/billing/billing-webhook.plugin';
import { BillingService } from '../../src/billing/billing.service';
import { StripeApi, StripeError } from '../../src/billing/stripe.api';
import { CONFIG, loadConfig, type AppConfig } from '../../src/config/config';
import { DetectionService } from '../../src/detection/detection.service';
import { PrismaService } from '../../src/database/prisma.service';
import { registerIngestRoutes } from '../../src/ingest/ingest.plugin';
import { IngestService } from '../../src/ingest/ingest.service';
import type { Alert } from '../../src/notifications/alert';
import { EmailService, type OutboundEmail } from '../../src/notifications/email.service';
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

/**
 * Captures account email instead of sending it. Separate from the sender
 * registry, which only covers alerts.
 */
export class RecordingEmailService {
  readonly sent: OutboundEmail[] = [];

  async send(email: OutboundEmail): Promise<void> {
    this.sent.push(email);
  }

  /** The most recent message to an address, which is the live one. */
  lastTo(address: string): OutboundEmail | undefined {
    return [...this.sent].reverse().find((email) => email.to === address);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Stands in for Stripe, so that no test contacts it: records what was asked, and
 * can be told to fail the way an unreachable Stripe does.
 */
export class FakeStripeApi extends StripeApi {
  readonly customers: Array<{ id: string; email: string; userId: string }> = [];
  readonly checkouts: Array<{ customerId: string; priceId: string; userId: string; successUrl: string; cancelUrl: string; automaticTax: boolean; locale?: 'fr' | 'en'; acceptance?: string }> = [];
  readonly portals: Array<{ customerId: string; returnUrl: string }> = [];
  readonly cancelled: string[] = [];
  failing = false;

  async createCustomer(input: { email: string; userId: string }): Promise<{ id: string }> {
    this.maybeFail();
    const id = `cus_${this.customers.length + 1}`;
    this.customers.push({ id, ...input });
    return { id };
  }

  async createCheckoutSession(input: FakeStripeApi['checkouts'][number]): Promise<{ url: string }> {
    this.maybeFail();
    this.checkouts.push(input);
    return { url: `https://checkout.stripe.test/${input.priceId}` };
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    this.maybeFail();
    this.portals.push(input);
    return { url: `https://portal.stripe.test/${input.customerId}` };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.maybeFail();
    this.cancelled.push(subscriptionId);
  }

  clear(): void {
    this.customers.length = 0;
    this.checkouts.length = 0;
    this.portals.length = 0;
    this.cancelled.length = 0;
    this.failing = false;
  }

  private maybeFail(): void {
    if (this.failing) throw new StripeError('simulated Stripe outage', 503, null);
  }
}

/** Where the tests pretend the web UI is served from: the origin a browser would send. */
export const TEST_BASE_URL = 'http://test.silencewatch.local';

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaService;
  detection: DetectionService;
  notifications: NotificationQueueService;
  senders: RecordingSenderRegistry;
  emails: RecordingEmailService;
  stripe: FakeStripeApi;
  config: AppConfig;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(
  /** Environment overrides, for the flags that are off by default. */
  overrides: Record<string, string> = {},
  /** Stands in for the providers' servers, which a test cannot reach. See createAuth. */
  authAdjust?: (options: BetterAuthOptions) => BetterAuthOptions,
): Promise<TestApp> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? (process.env.DATABASE_URL as string);

  // The loops are driven explicitly by the tests: a background tick would make
  // assertions racy.
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    SECRET_KEY: 'test-secret-key-that-is-long-enough',
    BASE_URL: TEST_BASE_URL,
    NODE_ENV: 'test',
    // Passwords, because a test can type one: a passkey needs a browser.
    AUTH_MODE: 'password',
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
    ...overrides,
  } as NodeJS.ProcessEnv);

  const senders = new RecordingSenderRegistry();
  const emails = new RecordingEmailService();
  const stripe = new FakeStripeApi();

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(SenderRegistry)
    .useValue(senders)
    .overrideProvider(EmailService)
    .useValue(emails)
    .overrideProvider(StripeApi)
    .useValue(stripe);

  if (authAdjust !== undefined) {
    builder.overrideProvider(AUTH).useFactory({
      inject: [
        CONFIG,
        PrismaService,
        UsersRepository,
        SignupPolicyService,
        LoginLockoutService,
        RecoveryCodesService,
        AuditService,
      ],
      factory: (
        appConfig: AppConfig,
        prisma: PrismaService,
        users: UsersRepository,
        signup: SignupPolicyService,
        lockout: LoginLockoutService,
        recovery: RecoveryCodesService,
        audit: AuditService,
      ): Auth => createAuth({ config: appConfig, prisma, users, signup, lockout, recovery, audit }, authAdjust),
    });
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    // trustProxy has to be threaded through exactly as main.ts does it: it
    // decides where `request.ip` comes from, and every per-source control —
    // rate limits, the sign-up velocity rule, the addresses in the audit trail
    // — reads that. A harness that always says 127.0.0.1 cannot test any of them.
    new FastifyAdapter({ logger: false, trustProxy: config.TRUST_PROXY as boolean | string }),
  );

  await registerIngestRoutes(
    app.getHttpAdapter().getInstance() as never,
    app.get(IngestService),
    config,
  );
  registerAuthRoutes(app.getHttpAdapter().getInstance() as never, app.get<Auth>(AUTH), config);
  await registerBillingWebhook(
    app.getHttpAdapter().getInstance() as never,
    app.get(BillingService),
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
      'TRUNCATE "user", project, project_member, session, account, verification, passkey, ' +
        'recovery_code, api_key, "check", ping, incident, notification_channel, ' +
        'notification_delivery, signup_attempt, audit_event, subscription, stripe_event ' +
        'RESTART IDENTITY CASCADE',
    );
    senders.clear();
    emails.clear();
    stripe.clear();
  };

  await reset();

  return {
    app,
    prisma,
    detection: app.get(DetectionService),
    notifications,
    senders,
    emails,
    stripe,
    config,
    reset,
    close: async (): Promise<void> => {
      await app.close();
    },
  };
}

/** The cookie a sign-in sets, as a browser would send it back: `name=value`. */
export function sessionCookieOf(setCookie: string | string[] | undefined): string {
  const lines = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const cookie = lines.find((line) => line.startsWith('sw.session_token='));
  if (cookie === undefined) throw new Error('no session cookie was set');
  return (cookie.split(';', 1)[0] as string).trim();
}

/**
 * Registers a user with a password and returns its session cookie plus first
 * project. The cookie is called `token` and passed to `auth()`, so a test reads
 * the same whatever the credential is.
 */
export async function registerUser(
  context: TestApp,
  email = `user-${Math.random().toString(36).slice(2)}@example.test`,
  headers: Record<string, string> = {},
): Promise<{ token: string; userId: string; projectId: string; email: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: TEST_BASE_URL, ...headers },
    payload: { email, password: 'a-sufficiently-long-password', name: '' },
  });
  if (response.statusCode !== 200) {
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  }

  const token = sessionCookieOf(response.headers['set-cookie']);
  const userId = response.json<{ user: { id: string } }>().user.id;
  const projects = await context.app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    headers: auth(token),
  });

  return {
    token,
    userId,
    projectId: projects.json<Array<{ id: string }>>()[0]?.id as string,
    email,
  };
}

/**
 * Signs an existing account in with its password, and returns the new cookie. A
 * sign-in is what makes a session "recent", so tests of what needs one call this.
 */
export async function signIn(
  context: TestApp,
  email: string,
  password = 'a-sufficiently-long-password',
): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: TEST_BASE_URL },
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-in failed: ${response.statusCode} ${response.body}`);
  }
  return sessionCookieOf(response.headers['set-cookie']);
}

/**
 * The headers of a caller: for an API key, the bearer header a machine sends; for
 * a session, what a browser holding it would send — its cookie, and where the page
 * came from.
 */
export function auth(token: string): Record<string, string> {
  if (token.startsWith('sw_')) return { authorization: `Bearer ${token}` };
  return { cookie: token, origin: TEST_BASE_URL };
}

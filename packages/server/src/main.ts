import 'reflect-metadata';

import { ConsoleLogger, Logger, RequestMethod, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { registerAuthRoutes } from './auth/better-auth/auth-routes';
import { AUTH } from './auth/better-auth/auth.provider';
import type { Auth } from './auth/better-auth/auth.factory';
import { registerBillingWebhook } from './billing/billing-webhook.plugin';
import { BillingService } from './billing/billing.service';
import { registerProxyTrustCheck } from './common/proxy-trust';
import { EventLoopLagMonitor, registerSlowRequestLog } from './common/runtime-watch';
import { loadConfig, type AppConfig } from './config/config';
import { registerIngestRoutes } from './ingest/ingest.plugin';
import { IngestService } from './ingest/ingest.service';
import { SILENCEWATCH_COMMIT, SILENCEWATCH_VERSION } from './version';
import { serveWebUi, toShell } from './web-ui';

const LOG_LEVELS: Record<AppConfig['LOG_LEVEL'], LogLevel[]> = {
  silent: [],
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

async function bootstrap(): Promise<void> {
  // Configuration is validated before anything else exists: a server that boots
  // with a broken alerting configuration is worse than one that refuses to boot.
  const config = loadConfig();
  const webRoot = join(__dirname, '..', 'public');
  const serveWeb = config.SERVE_WEB && existsSync(join(webRoot, 'index.html'));

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Deep links (/checks/<id>) are rewritten to the SPA shell *before*
      // routing, which is the only way to add a fallback without fighting Nest
      // over Fastify's single not-found handler.
      ...(serveWeb ? { rewriteUrl: (request: { url?: string }) => toShell(request.url ?? '/') } : {}),
      // Client IPs come from X-Forwarded-For only when explicitly told to trust
      // the proxy; otherwise per-IP limits could be spoofed away.
      trustProxy: config.TRUST_PROXY as boolean | string,
      bodyLimit: 1_048_576,
      // Heartbeat URLs are a kind of secret: not logging requests at all is the
      // simplest way to keep them out of access logs.
      logger: false,
    }),
    {
      logger: new ConsoleLogger({
        json: config.isProduction,
        colors: !config.isProduction,
        logLevels: LOG_LEVELS[config.LOG_LEVEL],
      }),
      bufferLogs: true,
    },
  );

  await configureSecurity(app, config);

  // Watches whether X-Forwarded-For actually turns up as configured. Both ways
  // of getting TRUST_PROXY wrong are silent, and both break every control keyed
  // on the client address.
  registerProxyTrustCheck(app.getHttpAdapter().getInstance() as never, config);

  // Ingestion is mounted straight on Fastify, bypassing the Nest pipeline
  // entirely. See ingest.plugin.ts.
  await registerIngestRoutes(
    app.getHttpAdapter().getInstance() as never,
    app.get(IngestService),
    config,
  );

  // Sign-in is Better Auth's, which brings its own routing and is mounted whole.
  registerAuthRoutes(app.getHttpAdapter().getInstance() as never, app.get<Auth>(AUTH), config);

  // Stripe's webhook needs the body as it arrived, so it is mounted the same way.
  await registerBillingWebhook(
    app.getHttpAdapter().getInstance() as never,
    app.get(BillingService),
    config,
  );

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  if (serveWeb) await serveWebUi(app, webRoot);
  else if (config.SERVE_WEB) {
    new Logger('Bootstrap').warn(`No web UI found at ${webRoot} — serving the API only`);
  }

  // Evidence for the reports that cannot be reproduced: a stalled process and a
  // slow route both leave one line, and a healthy one leaves none.
  registerSlowRequestLog(app.getHttpAdapter().getInstance() as never);
  new EventLoopLagMonitor().start();

  // Lets onModuleDestroy hooks stop the loops and drain the pools on SIGTERM.
  app.enableShutdownHooks();

  await app.listen({ port: config.PORT, host: config.HOST });

  new Logger('Bootstrap').log(
    `SilenceWatch ${SILENCEWATCH_VERSION} (${SILENCEWATCH_COMMIT}) listening on ` +
      `${config.HOST}:${config.PORT} — base URL ${config.baseUrl}`,
  );
}

async function configureSecurity(app: NestFastifyApplication, config: AppConfig): Promise<void> {
  const helmet = (await import('@fastify/helmet')).default;
  const cors = (await import('@fastify/cors')).default;

  await app.register(helmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Angular Material injects component styles at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  // What the pages may ask the browser for: none of these. Passkeys are not in the
  // list, and keep the default that lets this origin use them.
  app.getHttpAdapter().getInstance().addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    done(null, payload);
  });

  // The UI is served same-origin, so CORS only matters for third-party API
  // consumers, which use API keys in a header — never cookies.
  const origins = [config.baseUrl, ...config.CORS_ORIGINS];
  await app.register(cors as never, {
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });
}

void bootstrap().catch((error: Error) => {
  // No logger yet at this point: plain stderr is the only reliable channel.
  process.stderr.write(`SilenceWatch failed to start: ${error.message}\n`);
  process.exitCode = 1;
});

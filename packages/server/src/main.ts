import 'reflect-metadata';

import { ConsoleLogger, Logger, RequestMethod, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { loadConfig, type AppConfig } from './config/config';
import { registerIngestRoutes } from './ingest/ingest.plugin';
import { IngestService } from './ingest/ingest.service';
import { SILENCEWATCH_COMMIT, SILENCEWATCH_VERSION } from './version';

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

  // Ingestion is mounted straight on Fastify, bypassing the Nest pipeline
  // entirely. See ingest.plugin.ts.
  await registerIngestRoutes(
    app.getHttpAdapter().getInstance() as never,
    app.get(IngestService),
    config,
  );

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  if (serveWeb) await serveWebUi(app, webRoot);
  else if (config.SERVE_WEB) {
    new Logger('Bootstrap').warn(`No web UI found at ${webRoot} — serving the API only`);
  }

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
        // The sign-up proof of work runs in a same-origin module worker. Named
        // explicitly because workerSrc does not inherit from scriptSrc in every
        // browser, and a silently blocked worker would look like a hung form.
        workerSrc: ["'self'"],
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

  // The UI is served same-origin, so CORS only matters for third-party API
  // consumers, which use bearer tokens — never cookies.
  const origins = [config.baseUrl, ...config.CORS_ORIGINS];
  await app.register(cors as never, {
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });
}

/**
 * Serves the compiled Angular application from the same process and the same
 * image: self-hosting must stay a single container.
 */
async function serveWebUi(app: NestFastifyApplication, root: string): Promise<void> {
  const fastifyStatic = (await import('@fastify/static')).default;

  await app.register(fastifyStatic as never, {
    root,
    // Hashed asset filenames may be cached forever; index.html never.
    setHeaders: (response: { setHeader: (name: string, value: string) => void }, path: string) => {
      response.setHeader(
        'cache-control',
        /\.[0-9a-f]{8,}\.(js|css|woff2?|svg|png|jpg|webp)$/i.test(path)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });
}

/** Paths owned by the server, which must keep answering 404 rather than HTML. */
const SERVER_PREFIXES = ['/api', '/p/', '/health'];

/**
 * Maps a browser navigation to the SPA shell, and leaves everything else alone.
 *
 * A mistyped ping URL has to stay a 404: returning the application shell would
 * make a broken cron entry look like a success to the script calling it.
 */
export function toShell(url: string): string {
  for (const prefix of SERVER_PREFIXES) {
    if (url.startsWith(prefix)) return url;
  }

  const path = url.split('?', 1)[0] ?? '/';
  if (path === '/') return url;

  // Anything that looks like a file (an extension in its last segment) is an
  // asset request: let @fastify/static answer, including with its own 404.
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return lastSegment.includes('.') ? url : '/index.html';
}

void bootstrap().catch((error: Error) => {
  // No logger yet at this point: plain stderr is the only reliable channel.
  process.stderr.write(`SilenceWatch failed to start: ${error.message}\n`);
  process.exitCode = 1;
});

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { serveWebUi, toShell } from '../src/web-ui';

/**
 * The static file path, which no other suite reaches: the plugin is registered
 * in bootstrap rather than in AppModule, so building the app from AppModule
 * skips it entirely.
 *
 * That gap let @fastify/static 10 through. Its `setHeaders` callback receives
 * the Fastify reply where version 8 passed the raw Node response — a change
 * that compiles, starts, and only throws when a file is actually served, so the
 * container booted and mapped every route before dying on the first asset.
 *
 * serveWebUi lives in its own module for this test's sake: main.ts is an entry
 * point, and importing it would run bootstrap().
 *
 * No database: an empty testing module is enough to register the plugin.
 */
describe('web UI', () => {
  let app: NestFastifyApplication;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'silencewatch-web-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>SilenceWatch</title>');
    writeFileSync(join(root, 'main.0123456789abcdef.js'), 'export default 0;');

    const moduleRef = await Test.createTestingModule({}).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await serveWebUi(app, root);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves a file at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/index.html' });

    // A failure here is the regression itself: `setHeaders` throwing leaves the
    // request without a usable response rather than returning an error status.
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('SilenceWatch');
  });

  it('lets a hashed asset be cached forever', async () => {
    const response = await app.inject({ method: 'GET', url: '/main.0123456789abcdef.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('never lets index.html be cached', async () => {
    const response = await app.inject({ method: 'GET', url: '/index.html' });

    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('answers a path that climbs out of the web root as refused, not as a crash', async () => {
    for (const url of ['/../package.json', '/api/../package.json', '/index.html%00.js']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(response.body).not.toContain('"name"');
    }
  });
});

describe('toShell', () => {
  it('sends a browser navigation to the application', () => {
    expect(toShell('/checks/42')).toBe('/index.html');
    expect(toShell('/settings?tab=keys')).toBe('/index.html');
  });

  it('leaves what the server owns alone, however many slashes it starts with', () => {
    for (const url of ['/api/v1/checks', '/p/abc', '/health', '//p/abc', '///p/abc/fail', '//api/v1/checks']) {
      expect(toShell(url)).toBe(url);
    }
  });
});

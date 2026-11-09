import type { AdminStatsDto } from '@silencewatch/shared';
import { auth, createTestApp, registerAdmin, type TestApp } from './utils/test-app';

const DAY = 86_400_000;
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

/**
 * The count of unique visitors the administrator sees: once per visitor and day,
 * robots left out, and nothing kept that names anyone.
 */
describe('unique visitors', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  const visit = (ip: string, userAgent?: string) =>
    context.app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      remoteAddress: ip,
      headers: userAgent === undefined ? {} : { 'user-agent': userAgent },
    });

  const visitors = async (): Promise<AdminStatsDto['visitors']> => {
    const admin = await registerAdmin(context);
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: auth(admin.token),
    });
    return response.json<AdminStatsDto>().visitors;
  };

  it('is open to anyone, takes nothing and answers nothing', async () => {
    const response = await visit('198.51.100.1', FIREFOX);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('counts a visitor once a day, however many pages they open', async () => {
    await visit('198.51.100.1', FIREFOX);
    await visit('198.51.100.1', FIREFOX);
    await visit('198.51.100.1', FIREFOX);
    // Another browser on the same connection, and another connection: two more.
    await visit('198.51.100.1', SAFARI);
    await visit('203.0.113.9', FIREFOX);

    expect(await context.prisma.appVisitor.count()).toBe(3);
    const counted = await visitors();
    expect(counted.last30Days).toBe(3);
    expect(counted.daily).toHaveLength(30);
    expect(counted.daily[29]).toBe(3);
  });

  it('leaves out robots, scripts and requests without a browser', async () => {
    await visit('198.51.100.2', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    await visit('198.51.100.3', 'curl/8.9.1');
    await visit('198.51.100.4', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/140.0 Safari/537.36');
    // An empty user agent (the test client sends one of its own when none is given).
    await visit('198.51.100.5', '');

    expect(await context.prisma.appVisitor.count()).toBe(0);
  });

  it('keeps no address and no user agent: only a hash that tells nothing on its own', async () => {
    await visit('198.51.100.6', FIREFOX);
    const [row] = await context.prisma.appVisitor.findMany();

    expect(row?.visitor).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain('198.51.100.6');
    expect(JSON.stringify(row)).not.toContain('Firefox');
  });

  it('shows the last 30 days, day by day, and nothing older', async () => {
    const at = (days: number) => new Date(Date.now() - days * DAY - 60_000);
    await context.prisma.appVisitor.createMany({
      data: [
        { day: at(2), visitor: 'a'.repeat(32), firstSeenAt: at(2) },
        { day: at(2), visitor: 'b'.repeat(32), firstSeenAt: at(2) },
        { day: at(40), visitor: 'c'.repeat(32), firstSeenAt: at(40) },
      ],
    });

    const counted = await visitors();
    expect(counted.last30Days).toBe(2);
    expect(counted.daily[27]).toBe(2);
  });
});

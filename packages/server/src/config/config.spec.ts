import { loadConfig } from './config';

const minimal = {
  DATABASE_URL: 'postgresql://localhost:5432/silencewatch',
  SECRET_KEY: 'x'.repeat(32),
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(minimal);
    expect(config.PORT).toBe(8080);
    expect(config.DETECTION_INTERVAL_MS).toBe(10_000);
    expect(config.PING_RETENTION_DAYS).toBe(90);
    expect(config.ALLOW_PRIVATE_NOTIFICATION_TARGETS).toBe(false);
    expect(config.isProduction).toBe(false);
  });

  // Compose and Swarm turn `KEY: ${KEY:-}` into `KEY=""`, and so does a shell
  // exporting an .env line with nothing after the `=`. Every optional setting
  // therefore arrives empty rather than absent whenever it is left blank, which
  // used to stop the server on a configuration that was deliberately not set.
  it('treats a blank optional setting as unset rather than invalid', () => {
    const config = loadConfig({
      ...minimal,
      SMTP_URL: '',
      POSTMARK_TOKEN: '',
      BREVO_API_KEY: '',
      OUTBOUND_HEARTBEAT_URL: '',
    } as NodeJS.ProcessEnv);

    expect(config.SMTP_URL).toBeUndefined();
    expect(config.POSTMARK_TOKEN).toBeUndefined();
    expect(config.BREVO_API_KEY).toBeUndefined();
    expect(config.OUTBOUND_HEARTBEAT_URL).toBeUndefined();
  });

  it('still rejects a value that is present and wrong', () => {
    expect(() =>
      loadConfig({ ...minimal, OUTBOUND_HEARTBEAT_URL: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrow(/OUTBOUND_HEARTBEAT_URL/);
  });

  it('refuses a secret short enough to brute force', () => {
    expect(() => loadConfig({ ...minimal, SECRET_KEY: 'too-short' })).toThrow(/at least 32/);
  });

  it('requires a database URL', () => {
    expect(() => loadConfig({ SECRET_KEY: 'x'.repeat(32) } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });

  it('normalises the base URL so links never double their slashes', () => {
    expect(loadConfig({ ...minimal, BASE_URL: 'https://watch.example.com/' }).baseUrl).toBe(
      'https://watch.example.com',
    );
  });

  it('rejects an email provider that silently drops alerts in production', () => {
    expect(() =>
      loadConfig({
        ...minimal,
        NODE_ENV: 'production',
        BASE_URL: 'https://watch.example.com',
        EMAIL_PROVIDER: 'console',
      }),
    ).toThrow(/console transport drops alerts/);
  });

  it('rejects plaintext base URLs in production', () => {
    expect(() =>
      loadConfig({
        ...minimal,
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtp://relay.example.com',
        BASE_URL: 'http://watch.example.com',
      }),
    ).toThrow(/must be https/);
  });

  it('demands the credentials of the chosen email provider', () => {
    expect(() => loadConfig({ ...minimal, EMAIL_PROVIDER: 'postmark' })).toThrow(/POSTMARK_TOKEN/);
    expect(() => loadConfig({ ...minimal, EMAIL_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY/);
    expect(() => loadConfig({ ...minimal, EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_URL/);
  });

  it('parses booleans and comma-separated lists', () => {
    const config = loadConfig({
      ...minimal,
      SERVE_WEB: 'false',
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com ,',
    });
    expect(config.SERVE_WEB).toBe(false);
    expect(config.CORS_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('keeps intervals inside sane bounds', () => {
    expect(() => loadConfig({ ...minimal, DETECTION_INTERVAL_MS: '10' })).toThrow();
    expect(() => loadConfig({ ...minimal, PING_RETENTION_DAYS: '0' })).toThrow();
    expect(() => loadConfig({ ...minimal, PORT: '70000' })).toThrow();
  });

  it('is frozen, so nothing can flip a safeguard at runtime', () => {
    const config = loadConfig(minimal);
    expect(() => {
      (config as { PORT: number }).PORT = 1;
    }).toThrow();
  });
});

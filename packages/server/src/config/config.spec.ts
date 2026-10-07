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

  describe('billing', () => {
    const PLAN_LIMITS = JSON.stringify({
      free: { checks: 10 },
      pro: { checks: 100 },
      business: { checks: 1000 },
    });
    const STRIPE_PLANS = JSON.stringify({
      pro: { price: 'price_pro', amount: 499 },
      business: { price: 'price_business', amount: 1999 },
    });
    const billing = {
      ...minimal,
      QUOTAS_ENABLED: 'true',
      PLAN_LIMITS,
      BILLING_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123456789',
      STRIPE_WEBHOOK_SECRET: 'whsec_123456789',
      STRIPE_PLANS,
    } as NodeJS.ProcessEnv;

    it('is off, and asks for nothing, by default', () => {
      const config = loadConfig(minimal);
      expect(config.BILLING_ENABLED).toBe(false);
      expect(config.stripePlans).toEqual({});
      expect(config.STRIPE_SECRET_KEY).toBeUndefined();
    });

    it('accepts a complete setup', () => {
      const config = loadConfig(billing);
      expect(config.stripePlans.pro).toEqual({ price: 'price_pro', amount: 499 });
    });

    it('needs quotas, the key, the signing secret and at least one paid plan', () => {
      expect(() => loadConfig({ ...billing, QUOTAS_ENABLED: 'false' })).toThrow(/needs QUOTAS_ENABLED/);
      expect(() => loadConfig({ ...billing, STRIPE_SECRET_KEY: '' })).toThrow(/STRIPE_SECRET_KEY/);
      expect(() => loadConfig({ ...billing, STRIPE_WEBHOOK_SECRET: '' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
      expect(() => loadConfig({ ...billing, STRIPE_PLANS: '{}' })).toThrow(/no paid plan/);
    });

    it('refuses the publishable key and a secret that is not a signing secret', () => {
      expect(() => loadConfig({ ...billing, STRIPE_SECRET_KEY: 'pk_test_123456789' })).toThrow(/not the publishable/);
      expect(() => loadConfig({ ...billing, STRIPE_WEBHOOK_SECRET: 'sk_test_123456789' })).toThrow(/whsec_/);
    });

    it('refuses a plan that is not defined, is the default, or shares a price', () => {
      const plans = (value: unknown) => ({ ...billing, STRIPE_PLANS: JSON.stringify(value) });
      expect(() => loadConfig(plans({ gold: { price: 'price_g', amount: 1 } }))).toThrow(/not one of the plans/);
      expect(() => loadConfig(plans({ free: { price: 'price_f', amount: 1 } }))).toThrow(/cannot be bought/);
      expect(() =>
        loadConfig(
          plans({ pro: { price: 'price_same', amount: 1 }, business: { price: 'price_same', amount: 2 } }),
        ),
      ).toThrow(/two plans/);
      expect(() => loadConfig(plans({ pro: { price: 'nope', amount: 1 } }))).toThrow(/STRIPE_PLANS/);
    });
  });

  describe('abuse limits', () => {
    it('lets a connection have one account only when addresses are proven', () => {
      expect(() => loadConfig({ ...minimal, SIGNUP_MAX_ACCOUNTS_PER_ADDRESS: '1' })).toThrow(
        /needs EMAIL_VERIFICATION_REQUIRED/,
      );
      const config = loadConfig({
        ...minimal,
        SIGNUP_MAX_ACCOUNTS_PER_ADDRESS: '1',
        EMAIL_VERIFICATION_REQUIRED: 'true',
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtp://u:p@smtp.example.test:587',
      } as NodeJS.ProcessEnv);
      expect(config.SIGNUP_MAX_ACCOUNTS_PER_ADDRESS).toBe(1);
    });

    it('is off for one connection and on for test alerts by default', () => {
      const config = loadConfig(minimal);
      expect(config.SIGNUP_MAX_ACCOUNTS_PER_ADDRESS).toBe(0);
      expect(config.ALERT_MAX_PER_CHANNEL_PER_HOUR).toBe(0);
      expect(config.TEST_ALERT_COOLDOWN_SECONDS).toBe(60);
      expect(config.TEST_ALERT_MAX_PER_HOUR).toBe(20);
    });
  });
});

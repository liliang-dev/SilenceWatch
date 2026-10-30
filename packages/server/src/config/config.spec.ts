import { loadConfig } from './config';

const minimal = {
  DATABASE_URL: 'postgresql://localhost:5432/silencewatch',
  SECRET_KEY: 'x'.repeat(32),
  ADMIN_EMAIL: 'admin@example.test',
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

  it("requires the administrator's address, and keeps it in lower case", () => {
    const { ADMIN_EMAIL: _admin, ...withoutAdmin } = minimal;
    expect(() => loadConfig(withoutAdmin as NodeJS.ProcessEnv)).toThrow(/ADMIN_EMAIL: required/);
    // What Compose passes for a variable left blank.
    expect(() => loadConfig({ ...minimal, ADMIN_EMAIL: '' })).toThrow(/ADMIN_EMAIL/);
    expect(() => loadConfig({ ...minimal, ADMIN_EMAIL: 'not-an-address' })).toThrow(/ADMIN_EMAIL: must be an email/);
    expect(loadConfig({ ...minimal, ADMIN_EMAIL: ' Boss@Example.TEST ' }).ADMIN_EMAIL).toBe('boss@example.test');
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
    it('lets a connection have one account without asking for anything else', () => {
      expect(loadConfig({ ...minimal, SIGNUP_MAX_ACCOUNTS_PER_ADDRESS: '1' }).SIGNUP_MAX_ACCOUNTS_PER_ADDRESS).toBe(1);
    });

    it('is off for one connection and on for test alerts by default', () => {
      const config = loadConfig(minimal);
      expect(config.SIGNUP_MAX_ACCOUNTS_PER_ADDRESS).toBe(0);
      expect(config.ALERT_MAX_PER_CHANNEL_PER_HOUR).toBe(0);
      expect(config.TEST_ALERT_COOLDOWN_SECONDS).toBe(60);
      expect(config.TEST_ALERT_MAX_PER_HOUR).toBe(20);
    });
  });

  describe('sign-in', () => {
    const oauth = {
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 'g',
      MICROSOFT_CLIENT_ID: 'm',
      MICROSOFT_CLIENT_SECRET: 'm',
    };
    const hosted = { ...minimal, BASE_URL: 'https://watch.example.com' } as NodeJS.ProcessEnv;

    it('uses passkeys unless told otherwise', () => {
      const config = loadConfig(minimal);
      expect(config.AUTH_MODE).toBe('passkey');
      expect(config.MICROSOFT_TENANT_ID).toBe('common');
    });

    it.each(['passkey', 'password', 'full'])('accepts %s', (mode) => {
      expect(loadConfig({ ...hosted, ...oauth, AUTH_MODE: mode }).AUTH_MODE).toBe(mode);
    });

    it('refuses any other mode, and lists the valid ones', () => {
      for (const mode of ['both', 'PASSKEY', 'google', 'oauth', '']) {
        expect(() => loadConfig({ ...minimal, AUTH_MODE: mode })).toThrow(
          /is not a sign-in mode\. Valid values: passkey, password, full/,
        );
      }
    });

    it('needs at least one provider in full mode, and only there', () => {
      expect(() => loadConfig({ ...hosted, AUTH_MODE: 'full' })).toThrow(/full needs at least one provider/);
      expect(() => loadConfig({ ...hosted, AUTH_MODE: 'password' })).not.toThrow();
      expect(() => loadConfig({ ...hosted, AUTH_MODE: 'passkey' })).not.toThrow();
    });

    it('lets either provider be set up alone, but not half of one', () => {
      const google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
      const microsoft = { MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 'secret' };
      expect(() => loadConfig({ ...hosted, ...google, AUTH_MODE: 'full' })).not.toThrow();
      expect(() => loadConfig({ ...hosted, ...microsoft, AUTH_MODE: 'full' })).not.toThrow();
      expect(() => loadConfig({ ...hosted, ...oauth, AUTH_MODE: 'full', MICROSOFT_CLIENT_SECRET: '' })).toThrow(
        /MICROSOFT_CLIENT_SECRET.*required with MICROSOFT_CLIENT_ID/s,
      );
      expect(() => loadConfig({ ...hosted, GOOGLE_CLIENT_ID: 'id', AUTH_MODE: 'full' })).toThrow(
        /GOOGLE_CLIENT_SECRET.*required with GOOGLE_CLIENT_ID/s,
      );
    });

    it('wants https for passkeys, but lets localhost be developed on', () => {
      for (const mode of ['passkey', 'full']) {
        expect(() =>
          loadConfig({ ...minimal, ...oauth, AUTH_MODE: mode, BASE_URL: 'http://watch.example.com' }),
        ).toThrow(/must be https \(or localhost\)/);
        expect(() =>
          loadConfig({ ...minimal, ...oauth, AUTH_MODE: mode, BASE_URL: 'http://localhost:8080' }),
        ).not.toThrow();
      }
      // A password needs no secure origin: that is the server's HTTPS check, in production.
      expect(() =>
        loadConfig({ ...minimal, AUTH_MODE: 'password', BASE_URL: 'http://watch.internal:8080' }),
      ).not.toThrow();
    });

    it('ties the passkey domain to the address the UI is served from', () => {
      expect(() => loadConfig({ ...hosted, AUTH_RP_ID: 'example.com' })).not.toThrow();
      expect(() => loadConfig({ ...hosted, AUTH_RP_ID: 'watch.example.com' })).not.toThrow();
      expect(() => loadConfig({ ...hosted, AUTH_RP_ID: 'other.com' })).toThrow(/parent domain/);
      expect(() => loadConfig({ ...hosted, AUTH_RP_ID: 'notexample.com' })).toThrow(/parent domain/);
      expect(() => loadConfig({ ...hosted, AUTH_RP_ID: 'sub.watch.example.com' })).toThrow(/parent domain/);
      expect(() => loadConfig({ ...hosted, AUTH_RP_ID: 'com' })).toThrow(/parent domain|top-level/);
    });

    it('keeps every extra origin inside that domain', () => {
      const withOrigins = (origins: string) => ({ ...hosted, AUTH_RP_ID: 'example.com', AUTH_TRUSTED_ORIGINS: origins });
      expect(() => loadConfig(withOrigins('https://app.example.com'))).not.toThrow();
      expect(() => loadConfig(withOrigins('https://evil.com'))).toThrow(/outside AUTH_RP_ID/);
      expect(() => loadConfig(withOrigins('http://app.example.com'))).toThrow(/must be https/);
      expect(() => loadConfig(withOrigins('https://app.example.com/path'))).toThrow(/not an origin/);
      expect(() => loadConfig(withOrigins('not a url'))).toThrow(/not an origin/);
    });

    it('does not apply any of that to passwords', () => {
      expect(() =>
        loadConfig({
          ...minimal,
          AUTH_MODE: 'password',
          BASE_URL: 'http://watch.example.com',
          AUTH_RP_ID: 'other.com',
          AUTH_TRUSTED_ORIGINS: 'http://elsewhere.test',
        }),
      ).not.toThrow();
    });

    it('treats a blank optional setting as unset', () => {
      const config = loadConfig({ ...minimal, AUTH_RP_ID: '', GOOGLE_CLIENT_ID: '' });
      expect(config.AUTH_RP_ID).toBeUndefined();
      expect(config.GOOGLE_CLIENT_ID).toBeUndefined();
    });

    it('is not configured by the settings of the system it replaced', () => {
      // These used to exist; setting them now does nothing, and the schema ignores them.
      const config = loadConfig({ ...minimal, ACCESS_TOKEN_TTL_SECONDS: '60', EMAIL_VERIFICATION_REQUIRED: 'true' });
      expect('ACCESS_TOKEN_TTL_SECONDS' in config).toBe(false);
      expect('EMAIL_VERIFICATION_REQUIRED' in config).toBe(false);
    });
  });
});

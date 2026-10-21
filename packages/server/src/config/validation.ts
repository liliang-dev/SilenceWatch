import { z } from 'zod';
import type { Env } from './env.schema';
import { parsePlanLimits } from './plan-limits';
import { parseStripePlans } from './stripe-plans';

/**
 * Rules that involve several settings at once: a provider that needs its
 * credentials, quotas that need a plan, and what is not acceptable in production.
 * One setting alone is validated by its own schema, in `groups/`.
 */
export function validateEnv(env: Env, ctx: z.RefinementCtx): void {
  if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_URL'], message: 'required when EMAIL_PROVIDER=smtp' });
  }
  if (env.EMAIL_PROVIDER === 'postmark' && !env.POSTMARK_TOKEN) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['POSTMARK_TOKEN'], message: 'required when EMAIL_PROVIDER=postmark' });
  }
  if (env.EMAIL_PROVIDER === 'brevo' && !env.BREVO_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['BREVO_API_KEY'], message: 'required when EMAIL_PROVIDER=brevo' });
  }
  validateAuth(env, ctx);

  // A quota system nobody configured would silently give every account the
  // unlimited plan, which is the failure that only shows up on the invoice.
  const plans = parsePlanLimits(env.PLAN_LIMITS);
  if (plans === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PLAN_LIMITS'],
      message: 'must be a JSON object of {plan: {checks?, projects?, channelsPerProject?, retentionDays?}}',
    });
  } else if (env.QUOTAS_ENABLED) {
    if (Object.keys(plans).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLAN_LIMITS'],
        message: 'QUOTAS_ENABLED is on but no plan is defined, so every account would be unlimited',
      });
    } else if (plans[env.DEFAULT_PLAN] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEFAULT_PLAN'],
        message: `"${env.DEFAULT_PLAN}" is not one of the plans in PLAN_LIMITS (${Object.keys(plans).join(', ')})`,
      });
    }
  }

  validateBilling(env, ctx, plans);

  if (env.NODE_ENV === 'production') {
    // `true` trusts the hop count blindly, so anything that can reach the
    // server directly can claim any client address it likes. Naming the
    // proxy's address is the difference between a control and a decoration.
    if (env.TRUST_PROXY === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY'],
        message:
          'in production, set this to your proxy address or CIDR (e.g. 10.0.0.0/8) rather than "true" — ' +
          'a bare true lets anything that can reach the server forge its own client address',
      });
    }
    if (env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: 'console transport drops alerts; configure smtp, postmark or brevo in production',
      });
    }
    if (env.BASE_URL.startsWith('http://') && !env.BASE_URL.startsWith('http://localhost')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BASE_URL'],
        message: 'must be https in production',
      });
    }
  }
}

/**
 * Sign-in has to be able to work as configured. Everything here fails the boot,
 * because the alternative is an instance that starts and then refuses every
 * login: a passkey bound to the wrong domain, or a provider with no credentials.
 */
function validateAuth(env: Env, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string): void =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (env.AUTH_MODE === 'full') {
    const credentials = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
    ] as const;
    for (const name of credentials) {
      if (env[name] === undefined) issue(name, 'required when AUTH_MODE=full');
    }
  }

  if (env.AUTH_MODE === 'password') return;

  // Passkeys, below: WebAuthn only runs on a secure origin, and a credential is
  // bound to a domain.
  const base = new URL(env.BASE_URL);
  if (base.protocol !== 'https:' && !isLocalhost(base.hostname)) {
    issue(
      'BASE_URL',
      `must be https (or localhost) when AUTH_MODE=${env.AUTH_MODE}: browsers refuse passkeys on a plain http origin`,
    );
  }

  const rpId = (env.AUTH_RP_ID ?? base.hostname).toLowerCase();
  if (!withinDomain(base.hostname, rpId)) {
    issue(
      'AUTH_RP_ID',
      `"${rpId}" must be the host of BASE_URL (${base.hostname}) or a parent domain of it, or no passkey could ever be used`,
    );
  }
  if (!isLocalhost(rpId) && !rpId.includes('.')) {
    issue('AUTH_RP_ID', `"${rpId}" is a top-level domain, which browsers do not accept as a passkey domain`);
  }

  for (const origin of env.AUTH_TRUSTED_ORIGINS) {
    const parsed = parseOrigin(origin);
    if (parsed === null) {
      issue('AUTH_TRUSTED_ORIGINS', `"${origin}" is not an origin (expected https://host[:port], no path)`);
    } else if (parsed.protocol !== 'https:' && !isLocalhost(parsed.hostname)) {
      issue('AUTH_TRUSTED_ORIGINS', `"${origin}" must be https (or localhost) when AUTH_MODE=${env.AUTH_MODE}`);
    } else if (!withinDomain(parsed.hostname, rpId)) {
      issue('AUTH_TRUSTED_ORIGINS', `"${origin}" is outside AUTH_RP_ID (${rpId}), so passkeys made there would not work`);
    }
  }
}

const isLocalhost = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost');

/** Whether `host` is `domain` or a subdomain of it: the rule that ties an origin to an rpID. */
const withinDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.origin === value ? url : null;
  } catch {
    return null;
  }
}

/**
 * Billing needs everything it names to exist: a plan that is not in PLAN_LIMITS
 * would be sold and then grant nothing, and the key and secret are what make the
 * payment page and the webhook work at all.
 */
function validateBilling(
  env: Env,
  ctx: z.RefinementCtx,
  plans: ReturnType<typeof parsePlanLimits>,
): void {
  const issue = (path: string, message: string): void =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  const stripePlans = parseStripePlans(env.STRIPE_PLANS);
  if (stripePlans === null) {
    issue('STRIPE_PLANS', 'must be a JSON object of {plan: {price: "price_…", amount: <cents>}}');
  }
  if (env.BILLING_PROFESSIONAL_ONLY && !env.BILLING_TERMS_URL) {
    issue('BILLING_PROFESSIONAL_ONLY', 'needs BILLING_TERMS_URL: the declaration is made in the box that accepts the terms');
  }
  if (!env.BILLING_ENABLED) return;

  if (!env.QUOTAS_ENABLED) {
    issue('BILLING_ENABLED', 'needs QUOTAS_ENABLED: a subscription only chooses a plan, and without quotas no plan limits anything');
  }
  if (env.STRIPE_SECRET_KEY === undefined) {
    issue('STRIPE_SECRET_KEY', 'required when BILLING_ENABLED is on');
  } else if (!/^(sk|rk)_/.test(env.STRIPE_SECRET_KEY)) {
    issue('STRIPE_SECRET_KEY', 'must be a secret or restricted key (sk_… or rk_…), not the publishable one');
  }
  if (env.STRIPE_WEBHOOK_SECRET === undefined) {
    issue('STRIPE_WEBHOOK_SECRET', 'required when BILLING_ENABLED is on: without it no payment could ever be recorded');
  } else if (!env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    issue('STRIPE_WEBHOOK_SECRET', 'must be the endpoint signing secret (whsec_…)');
  }

  if (stripePlans === null) return;
  if (Object.keys(stripePlans).length === 0) {
    issue('STRIPE_PLANS', 'BILLING_ENABLED is on but no paid plan is defined');
    return;
  }
  const prices = new Set<string>();
  for (const [name, plan] of Object.entries(stripePlans)) {
    if (plans?.[name] === undefined) {
      issue('STRIPE_PLANS', `"${name}" is not one of the plans in PLAN_LIMITS`);
    }
    if (name === env.DEFAULT_PLAN) {
      issue('STRIPE_PLANS', `"${name}" is the plan every account starts on, so it cannot be bought`);
    }
    if (prices.has(plan.price)) {
      issue('STRIPE_PLANS', `the price ${plan.price} is used by two plans, so a payment could not tell them apart`);
    }
    prices.add(plan.price);
  }
}

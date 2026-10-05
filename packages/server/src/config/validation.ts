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
  // Requiring a verification email while alerts only go to the log would lock
  // every new account out of an instance that looks perfectly healthy.
  if (env.EMAIL_VERIFICATION_REQUIRED && env.EMAIL_PROVIDER === 'console') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMAIL_VERIFICATION_REQUIRED'],
      message:
        'needs a real email transport: with EMAIL_PROVIDER=console nobody could ever verify an address',
    });
  }
  // Without proven addresses every account would stop counting after an hour,
  // and the rule would only slow a flood down.
  if (env.SIGNUP_MAX_ACCOUNTS_PER_ADDRESS > 0 && !env.EMAIL_VERIFICATION_REQUIRED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SIGNUP_MAX_ACCOUNTS_PER_ADDRESS'],
      message:
        'needs EMAIL_VERIFICATION_REQUIRED: only accounts with a proven address keep counting, so without it the limit would lapse after an hour',
    });
  }
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

import { z } from 'zod';
import type { Env } from './env.schema';
import { parsePlanLimits } from './plan-limits';

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

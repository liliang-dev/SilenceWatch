import type { z } from 'zod';
import { envSchema } from './env.schema';
import { parsePlanLimits, type PlanLimits } from './plan-limits';
import { parseStripePlans, type StripePlan } from './stripe-plans';

export type { PlanLimits, StripePlan };

/**
 * Every knob of the server is an environment variable — self-hosting must never
 * require editing a file inside the image. The process refuses to boot on an
 * invalid or unsafe configuration rather than starting in a degraded state.
 */
export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  readonly isProduction: boolean;
  readonly baseUrl: string;
  /** PLAN_LIMITS, parsed once at boot. */
  readonly planLimits: Readonly<Record<string, PlanLimits>>;
  /** STRIPE_PLANS, parsed once at boot. */
  readonly stripePlans: Readonly<Record<string, StripePlan>>;
};

export const CONFIG = Symbol('SILENCEWATCH_CONFIG');

/** Parses and freezes configuration. Throws a readable aggregate on failure. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid SilenceWatch configuration:\n${details}`);
  }

  return Object.freeze({
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    // Normalised once so callers can concatenate paths without double slashes.
    baseUrl: parsed.data.BASE_URL.replace(/\/+$/, ''),
    // Validated above, so this cannot be null by the time we get here.
    planLimits: Object.freeze(parsePlanLimits(parsed.data.PLAN_LIMITS) ?? {}),
    stripePlans: Object.freeze(parseStripePlans(parsed.data.STRIPE_PLANS) ?? {}),
  });
}

import type { AppConfig } from '../../config/config';

/** The social sign-in providers Better Auth is given. */
export const SOCIAL_PROVIDERS = ['google', 'microsoft'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/**
 * The providers an instance offers: those whose client id and secret are both
 * set, and only in `full` mode. An operator can register the applications one
 * at a time, and a provider with no credentials has no button, no sign-in
 * endpoint and no callback.
 */
export function enabledProviders(
  config: Pick<
    AppConfig,
    | 'AUTH_MODE'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
    | 'MICROSOFT_CLIENT_ID'
    | 'MICROSOFT_CLIENT_SECRET'
  >,
): SocialProvider[] {
  if (config.AUTH_MODE !== 'full') return [];
  const providers: SocialProvider[] = [];
  if (config.GOOGLE_CLIENT_ID !== undefined && config.GOOGLE_CLIENT_SECRET !== undefined) providers.push('google');
  if (config.MICROSOFT_CLIENT_ID !== undefined && config.MICROSOFT_CLIENT_SECRET !== undefined) {
    providers.push('microsoft');
  }
  return providers;
}

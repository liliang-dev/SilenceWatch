import type { AuthMode } from '../../config/groups/auth';

/**
 * The Better Auth endpoints an instance answers, by mode.
 *
 * Better Auth ships many more (change email, link accounts, list sessions…), and
 * the web UI uses none of them. Left reachable they would be features nobody
 * decided to offer, so the mount answers 404 to anything not named here — which
 * also makes "only the chosen methods exist" true of the URL space and not just
 * of the configuration.
 */
export function allowedAuthPaths(mode: AuthMode): ReadonlySet<string> {
  const paths = ['/sign-out'];

  if (mode === 'password') {
    paths.push('/sign-up/email', '/sign-in/email', '/change-password');
  } else {
    paths.push(
      '/passkey/generate-register-options',
      '/passkey/generate-authenticate-options',
      '/passkey/verify-registration',
      '/passkey/verify-authentication',
      '/passkey/list-user-passkeys',
      '/passkey/update-passkey',
      '/passkey/delete-passkey',
    );
  }
  if (mode === 'passkey') {
    paths.push('/recovery-codes/generate', '/recovery-codes/remaining', '/recovery-codes/sign-in');
  }
  if (mode === 'full') {
    paths.push('/sign-in/social', '/callback/google', '/callback/microsoft');
  }
  return new Set(paths);
}

import { z } from 'zod';
import { booleanish, csv, optional } from '../env-helpers';

/** How people sign in. The only values AUTH_MODE accepts. */
export const AUTH_MODES = ['passkey', 'password', 'full'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** Secrets, who may sign up, and how they prove who they are. */
export const authShape = {
  /**
   * Root secret. Session cookies are signed with it, and so are the other keyed
   * values derived from it, so rotating it signs everyone out at once.
   */
  SECRET_KEY: z.string().min(32, 'SECRET_KEY must be at least 32 characters'),
  /** When false, the administrator's account is the only one that can be created. */
  SIGNUP_ENABLED: booleanish.prefault('true'),

  /**
   * The sign-in methods this instance offers, and nothing else:
   *
   *  - `passkey`: passkeys only, with recovery codes. The default.
   *  - `password`: email and password.
   *  - `full`: passkeys, Google and Microsoft.
   *
   * Only what the mode names is mounted; the other methods have no endpoint at
   * all. Changing it later never deletes an account: see docs/authentication.md.
   */
  AUTH_MODE: z
    .enum(AUTH_MODES, {
      error: (issue) =>
        `"${String(issue.input)}" is not a sign-in mode. Valid values: ${AUTH_MODES.join(', ')}`,
    })
    .default('passkey'),
  /**
   * The domain passkeys are bound to. A passkey made for one rpID is useless on
   * another, so this is a decision to make once. It must be the host of BASE_URL
   * or a parent domain of it. Defaults to the host of BASE_URL.
   */
  AUTH_RP_ID: optional(z.string().min(1)),
  AUTH_RP_NAME: z.string().min(1).max(80).default('SilenceWatch'),
  /**
   * Browser origins, besides BASE_URL, that may sign in and call the API with a
   * session. Needed only when the web UI is served from somewhere else (a
   * development server, for instance).
   */
  AUTH_TRUSTED_ORIGINS: csv.prefault(''),
  /**
   * The administrator's address. Required. The account with this address is the
   * only one that sees the instance's statistics and internals, and it can only be
   * created with a one-time link printed in the server log, which stands in for
   * proving that the address is yours: nothing else may register it.
   */
  ADMIN_EMAIL: z
    .string({
      error: 'required: the address of the administrator account, which gets a one-time link in the log',
    })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'must be an email address' })),

  /** Google sign-in (AUTH_MODE=full); the button shows only when both are set. */
  GOOGLE_CLIENT_ID: optional(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
  /** Microsoft sign-in (AUTH_MODE=full); the button shows only when both are set. */
  MICROSOFT_CLIENT_ID: optional(z.string().min(1)),
  MICROSOFT_CLIENT_SECRET: optional(z.string().min(1)),
  /** `common` accepts work, school and personal accounts; a tenant id restricts it to one organisation. */
  MICROSOFT_TENANT_ID: z.string().min(1).default('common'),
};

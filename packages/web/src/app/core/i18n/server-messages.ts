import type { MessageKey } from './messages';
import type { Translate } from './i18n.service';

/**
 * The server's own sentences, in the language of the page.
 *
 * The server speaks English only, and the sentences it sends for the things a
 * person can actually run into — a wrong password, an expired link, the last
 * project — are shown as they arrive. This table recognises those by their exact
 * text and shows the translation instead.
 *
 * Matching on wording is brittle, and it is allowed to be: a sentence the server
 * rewords simply stops matching and is shown in English, as it would have been
 * without this table. Nothing breaks, and nothing here decides behaviour — the
 * "confirm your email" button, for one, is driven by a flag, not by this text.
 */
const EXACT: ReadonlyArray<readonly [string, MessageKey]> = [
  ['Invalid email or password', 'server.invalidCredentials'],
  [
    'Confirm your email address before signing in. Check your inbox for the link.',
    'server.confirmEmail',
  ],
  ['Sign-up is disabled on this instance', 'server.signupDisabled'],
  ['Email already registered', 'server.emailTaken'],
  ['Current password is incorrect', 'server.wrongPassword'],
  [
    'Too many failed attempts. Try again in a few minutes or reset your password.',
    'server.tooManyFailed',
  ],
  ['Too many accounts created from this network. Try again later.', 'server.tooManyAccounts'],
  ['Too many requests', 'error.tooManyAttempts'],
  ['The sign-up challenge expired. Please try again.', 'server.challengeExpired'],
  [
    'This sign-up could not be verified. Please reload the page and try again.',
    'server.signupUnverified',
  ],
  [
    'This email provider is not accepted. Use an address you can receive mail at.',
    'server.emailProviderRejected',
  ],
  [
    'This reset link is no longer valid. Request a new one from the sign-in page.',
    'reset.invalid',
  ],
  [
    'This confirmation link is no longer valid. Request a new one from the sign-in page.',
    'verify.invalid',
  ],
  [
    'This is your last project, and an account needs one. Create another before deleting it.',
    'server.lastProject',
  ],
  ['Project not found', 'server.projectNotFound'],
  ['Check not found', 'server.checkNotFound'],
  ['Channel not found', 'server.channelNotFound'],
  ['Session expired', 'server.sessionExpired'],
  [
    'An account already exists from this network. Sign in to it, or contact us if this connection is shared.',
    'server.addressTaken',
  ],
  [
    'A project can have 25 active API keys. Revoke one you no longer use first.',
    'server.tooManyKeys',
  ],
];

/** Sentences that carry a reason after a fixed beginning: the reason stays as sent. */
const PREFIXED: ReadonlyArray<readonly [string, MessageKey]> = [
  ['Test delivery failed: ', 'server.testDeliveryFailed'],
  ['Channel target rejected: ', 'server.targetRejected'],
];

/** The translation of a server message, or the message itself when it is not one we know. */
export function translateServerMessage(message: string, t: Translate): string {
  const exact = EXACT.find(([english]) => english === message);
  if (exact !== undefined) return t(exact[1]);

  const prefixed = PREFIXED.find(([beginning]) => message.startsWith(beginning));
  if (prefixed !== undefined) {
    return t(prefixed[1], { reason: message.slice(prefixed[0].length) });
  }
  return message;
}

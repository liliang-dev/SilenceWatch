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
  ['Sign-up is disabled on this instance', 'server.signupDisabled'],
  ['This account cannot be created. Sign in if you already have one.', 'server.addressUnavailable'],
  ['User already exists. Use another email.', 'server.addressUnavailable'],
  [
    'This instance has no account yet. Open the setup link printed in the server log.',
    'server.noAccountYet',
  ],
  ['Enter a valid email address.', 'server.emailInvalid'],
  ['Sign in again to do this.', 'server.signInAgain'],
  ['Invalid password', 'server.wrongPassword'],
  ['Too many accounts created from this network. Try again later.', 'server.tooManyAccounts'],
  [
    'An account already exists from this network. Sign in to it, or contact us if this connection is shared.',
    'server.accountFromNetwork',
  ],
  ['Too many requests', 'error.tooManyAttempts'],
  [
    'This email provider is not accepted. Use an address you can receive mail at.',
    'server.emailProviderRejected',
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

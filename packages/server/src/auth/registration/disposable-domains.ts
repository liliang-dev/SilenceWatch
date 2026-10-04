/**
 * Disposable mailbox domains.
 *
 * This list is a speed bump, not a wall, and the honesty about that matters:
 * there are thousands of these services and new ones appear weekly, so a list
 * baked into a release is out of date the day it ships. It is here because the
 * head of the distribution is short — a handful of domains account for most
 * casual throwaway signups — and stopping those costs one Set lookup.
 *
 * The load-bearing defences are elsewhere (proof of work, verified delivery,
 * per-network velocity). Operators who want a maintained list point
 * SIGNUP_BLOCKED_EMAIL_DOMAINS at their own, refreshed on their own schedule.
 *
 * Deliberately *not* included: Gmail, Outlook, Proton, Tutanota and the other
 * free-but-real providers. They are where most legitimate users are, and
 * blocking them to stop bots is choosing to lose customers to avoid a nuisance.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '0-mail.com',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'byom.de',
  'dispostable.com',
  'dropmail.me',
  'emailfake.com',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'inboxkitten.com',
  'mail-temporaire.fr',
  'mail7.io',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailsac.com',
  'mailtemp.info',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nowmymail.com',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempm.com',
  'tempmail.dev',
  'tempmail.plus',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.me',
  'trashmail.net',
  'tmpmail.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/**
 * The registrable-ish tail of a hostname, so `foo.mailinator.com` is caught by
 * the `mailinator.com` entry.
 *
 * This walks suffixes rather than consulting a public-suffix list: getting the
 * real registrable domain right needs data this process has no business
 * shipping, and over-matching here would only ever block *more* subdomains of a
 * domain an operator already chose to block.
 */
export function domainSuffixes(domain: string): string[] {
  const labels = domain.split('.');
  const suffixes: string[] = [];
  for (let index = 0; index < labels.length - 1; index += 1) {
    suffixes.push(labels.slice(index).join('.'));
  }
  return suffixes;
}

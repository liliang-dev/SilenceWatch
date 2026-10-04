/**
 * Minimum gap between two messages to the same address.
 *
 * The per-IP limiter cannot see that a thousand registrations from a thousand
 * addresses all name one victim's mailbox. Without this, "forgot my password"
 * and "resend the link" are a mail cannon pointed at anyone whose address is
 * known — and the instance pays for it twice, because a sender that emits
 * unsolicited volume loses the deliverability its alerts depend on.
 */
export const EMAIL_COOLDOWN_MS = 60_000;

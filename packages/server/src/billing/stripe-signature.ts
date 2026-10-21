import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far a signed event's timestamp may be from now: Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Whether `header` (the `Stripe-Signature` header) is a valid signature of
 * `payload` made with the endpoint's signing secret.
 *
 * The header reads `t=<unix seconds>,v1=<hex>[,v1=<hex>…]` — several `v1` while a
 * secret is being rolled. The signature is HMAC-SHA256 over `<t>.<raw body>`, so
 * it has to be checked against the bytes as they arrived, before anything parses
 * them. Compared in constant time, and refused when the timestamp is too far from
 * now, so that a captured request cannot be replayed later.
 */
export function verifyStripeSignature(
  payload: Buffer,
  header: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (header === undefined || header === '') return false;

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }

  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

/** What the test, and nobody else, needs: a header Stripe would have sent. */
export function signStripePayload(payload: Buffer | string, secret: string, atSeconds: number): string {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const signature = createHmac('sha256', secret).update(`${atSeconds}.`).update(body).digest('hex');
  return `t=${atSeconds},v1=${signature}`;
}

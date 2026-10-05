import { signStripePayload, verifyStripeSignature } from './stripe-signature';

const SECRET = 'whsec_test_secret';
const NOW = 1_800_000_000;
const body = Buffer.from('{"id":"evt_1","type":"customer.subscription.updated"}');

describe('verifyStripeSignature', () => {
  it('accepts what was signed with the secret', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, NOW), SECRET, NOW)).toBe(true);
  });

  it('refuses another secret, a changed body and a missing or malformed header', () => {
    const header = signStripePayload(body, SECRET, NOW);
    expect(verifyStripeSignature(body, header, 'whsec_other', NOW)).toBe(false);
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), header, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, undefined, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, '', SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, 'garbage', SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, `t=${NOW}`, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, `t=${NOW},v1=abcd`, SECRET, NOW)).toBe(false);
  });

  it('refuses a timestamp that was not rewritten with the body', () => {
    const header = signStripePayload(body, SECRET, NOW).replace(`t=${NOW}`, `t=${NOW + 1}`);
    expect(verifyStripeSignature(body, header, SECRET, NOW)).toBe(false);
  });

  it('refuses a replay outside the tolerance, in either direction', () => {
    const old = signStripePayload(body, SECRET, NOW - 301);
    const future = signStripePayload(body, SECRET, NOW + 301);
    expect(verifyStripeSignature(body, old, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, future, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, NOW - 299), SECRET, NOW)).toBe(true);
  });

  it('accepts any one valid signature while a secret is being rolled', () => {
    const live = signStripePayload(body, SECRET, NOW);
    const rolled = `${live.replace('v1=', 'v1=' + '0'.repeat(64) + ',v1=')}`;
    expect(verifyStripeSignature(body, rolled, SECRET, NOW)).toBe(true);
  });
});

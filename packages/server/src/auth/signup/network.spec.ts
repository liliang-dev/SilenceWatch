import { addressOf, networkOf } from './network';

describe('networkOf', () => {
  it('collapses IPv4 to a /24', () => {
    expect(networkOf('203.0.113.42')).toBe('203.0.113.0/24');
    expect(networkOf('203.0.113.7')).toBe('203.0.113.0/24');
  });

  it('collapses IPv6 to a /48, so one host cannot spend its whole /64', () => {
    expect(networkOf('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
    expect(networkOf('2001:db8:abcd:9999::ff')).toBe('2001:db8:abcd::/48');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    expect(networkOf('::ffff:203.0.113.42')).toBe('203.0.113.0/24');
  });

  it('expands compressed IPv6', () => {
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(networkOf('::1')).toBe('0:0:0::/48');
  });

  it('answers "unknown" rather than guessing', () => {
    expect(networkOf(null)).toBe('unknown');
    expect(networkOf('')).toBe('unknown');
    expect(networkOf('not-an-address')).toBe('unknown');
  });

  it('refuses out-of-range octets instead of minting a bucket for them', () => {
    // With TRUST_PROXY on this value comes from a header. Every distinct
    // string it accepts is a fresh quota bucket, so garbage must collapse to
    // one rather than become an unlimited supply of them.
    expect(networkOf('999.1.1.1')).toBe('unknown');
    expect(networkOf('203.0.113.256')).toBe('unknown');
    expect(networkOf('203.0.113')).toBe('unknown');
  });
});

describe('addressOf', () => {
  it('keeps an IPv4 address whole', () => {
    expect(addressOf('203.0.113.42')).toBe('203.0.113.42');
  });

  it('narrows IPv6 to the /64 one line is given', () => {
    expect(addressOf('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd:1234::/64');
    expect(addressOf('2001:db8:abcd:1234:ffff::9')).toBe('2001:db8:abcd:1234::/64');
  });

  it('answers "unknown" for what it cannot read', () => {
    expect(addressOf(undefined)).toBe('unknown');
    expect(addressOf('999.1.1.1')).toBe('unknown');
  });
});

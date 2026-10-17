/**
 * Collapses an address to the network that rents it: /24 for IPv4, /48 for
 * IPv6. Individual addresses are the wrong unit — a residential proxy pool
 * hands out a fresh one per request, and an IPv6 host is routinely given a
 * whole /64 to play with.
 */
export function networkOf(ip: string | null | undefined): string {
  if (ip === null || ip === undefined || ip === '') return 'unknown';

  // ::ffff:203.0.113.4 is an IPv4 address wearing an IPv6 hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const address = mapped?.[1] ?? ip;

  if (address.includes(':')) {
    const groups = expandIPv6(address);
    return groups === null ? 'unknown' : `${groups.slice(0, 3).join(':')}::/48`;
  }

  // The range check is not pedantry. With TRUST_PROXY on, this value comes
  // from a header; anything accepted here becomes its own quota bucket, so a
  // lax parser would let a forged `X-Forwarded-For: 999.999.999.N` mint an
  // unlimited supply of fresh buckets and walk straight past the volume rule.
  const octets = address.split('.');
  return isIPv4(octets) ? `${octets.slice(0, 3).join('.')}.0/24` : 'unknown';
}

/**
 * The connection a request came from, as narrowly as one subscriber can be told
 * apart: an IPv4 address, or an IPv6 /64 (the block a single home or office
 * line is given, and what a person can change at will inside).
 *
 * `networkOf` above is the coarser unit of the hourly volume rule; this is the
 * unit of "one account per address".
 */
export function addressOf(ip: string | null | undefined): string {
  if (ip === null || ip === undefined || ip === '') return 'unknown';

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const address = mapped?.[1] ?? ip;

  if (address.includes(':')) {
    const groups = expandIPv6(address);
    return groups === null ? 'unknown' : `${groups.slice(0, 4).join(':')}::/64`;
  }

  return isIPv4(address.split('.')) ? address : 'unknown';
}

function isIPv4(octets: string[]): boolean {
  return (
    octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/** Returns the eight hextets of an IPv6 address, or null if it is not one. */
function expandIPv6(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] === '' ? [] : (halves[0] as string).split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] as string).split(':')) : [];

  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
      : head;

  if (groups.length !== 8) return null;
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;

  return groups.map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''));
}

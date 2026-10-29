/**
 * Where to go after signing in: a path on this site, or the checks.
 *
 * A "next" that leads elsewhere would make the sign-in page an open redirect. A
 * leading `//` is another host to a browser, and so is `/\`, which browsers read
 * as `//`; control characters are dropped by the URL parser and can turn a path
 * into either. Anything of the kind falls back to the checks.
 */
export function safeNextUrl(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//')) return '/checks';
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return '/checks';
  return next;
}

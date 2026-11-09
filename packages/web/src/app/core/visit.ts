/**
 * Tells the server that the application was opened, once per page load, for the
 * administrator's count of unique visitors. The server keeps a keyed hash per
 * visitor and day, never the address, and sets no cookie.
 *
 * Not sent when the browser asks not to be tracked (Do Not Track or Global Privacy
 * Control). Fire and forget: whether it arrives changes nothing on the page.
 */
export function reportVisit(): void {
  const browser = globalThis.navigator as (Navigator & { globalPrivacyControl?: boolean }) | undefined;
  if (browser === undefined || typeof fetch !== 'function') return;
  if (browser.doNotTrack === '1' || browser.globalPrivacyControl === true) return;

  fetch('/api/v1/visits', { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}

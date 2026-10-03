/**
 * Reads and writes `localStorage` without ever throwing.
 *
 * The browser can refuse it — a private window, blocked site data, a quota — and
 * a preference that cannot be remembered is no reason to stop the page from
 * rendering. Callers get `null` and carry on with the default.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; the choice still applies until the page is closed.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}

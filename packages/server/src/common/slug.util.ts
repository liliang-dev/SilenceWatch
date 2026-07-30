import { randomBytes } from 'node:crypto';

const MAX_SLUG_LENGTH = 60;

/**
 * URL-safe identifier derived from a display name. Accents are folded rather
 * than dropped ("Sauvegarde quotidienne" → "sauvegarde-quotidienne"), and an
 * input that folds away to nothing (e.g. only CJK or emoji) falls back to random
 * characters instead of producing an empty slug.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');

  return slug.length > 0 ? slug : randomBytes(4).toString('hex');
}

/**
 * Makes a slug unique by appending a short suffix. `isTaken` is consulted at most
 * `attempts` times before falling back to a random suffix, so this always
 * terminates — the database's unique constraint remains the real arbiter.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  const root = slugify(base);
  if (!(await isTaken(root))) return root;

  for (let attempt = 2; attempt <= attempts; attempt += 1) {
    const candidate = `${root.slice(0, MAX_SLUG_LENGTH - 3)}-${attempt}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  return `${root.slice(0, MAX_SLUG_LENGTH - 7)}-${randomBytes(3).toString('hex')}`;
}

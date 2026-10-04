import { sha256Hex } from '../common/crypto.util';
import { slugify } from '../common/slug.util';

/**
 * Slug for a starter-declared check: derived from the identity, not from the
 * display name, so renaming a job keeps its URL — and so the same job declared
 * by two environments does not collide on the per-project slug uniqueness.
 */
export function syncSlug(name: string, key: string, environment: string | null): string {
  const root = slugify(name).slice(0, 40).replace(/-+$/, '');
  const fingerprint = sha256Hex(`${environment ?? ''}|${key}`).slice(0, 8);
  return `${root.length > 0 ? `${root}-` : ''}${fingerprint}`;
}

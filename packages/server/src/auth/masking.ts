/** Logs must be shareable for support without handing over the user list. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (domain === undefined || local === undefined) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

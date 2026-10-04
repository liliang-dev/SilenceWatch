/**
 * Security-relevant actions. A closed set so the UI can label them and an
 * operator can grep for them; anything not here is not recorded.
 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_changed',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.email_verified',
  'account.registered',
  'account.deleted',
  'api_key.created',
  'api_key.revoked',
  'channel.created',
  'channel.updated',
  'channel.deleted',
  'channel.tested',
  'check.created',
  'check.deleted',
  'check.ping_key_rotated',
  'project.created',
  'project.updated',
  /**
   * The most destructive action in the product: it takes every check, every
   * ping and every incident with it. Recorded outside the project — by the time
   * anyone reads it, the project it names no longer exists.
   */
  'project.deleted',
  'quota.checks_paused',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEventDto {
  id: string;
  occurredAt: string;
  action: AuditAction;
  /** Who, denormalised so the entry survives the account's deletion. */
  actorEmail: string | null;
  actorIsApiKey: boolean;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

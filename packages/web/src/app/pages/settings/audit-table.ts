import type { AuditEventDto } from '@silencewatch/shared';
import type { TableRules } from '../../shared/data-table';

/** Human wording for the audit actions, so the table reads as prose. */
const AUDIT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset_completed': 'Password reset',
  'auth.email_verified': 'Email confirmed',
  'account.registered': 'Account created',
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
  'channel.created': 'Alert channel added',
  'channel.updated': 'Alert channel changed',
  'channel.deleted': 'Alert channel removed',
  'channel.tested': 'Alert channel tested',
  'check.created': 'Check created',
  'check.deleted': 'Check deleted',
  'check.ping_key_rotated': 'Ping URL rotated',
  'project.created': 'Project created',
  'project.updated': 'Project changed',
  'project.deleted': 'Project deleted',
  'quota.checks_paused': 'Checks paused by plan limit',
};

/** "auth.login_failed" reads as noise; "Sign-in failed" reads as a sentence. */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}

/**
 * The two entries worth finding in a hurry.
 *
 * A failed sign-in is the one thing on this page someone might not have done
 * themselves, and checks paused by a quota is the one thing that stops
 * monitoring without anyone touching it.
 */
export function isFailure(action: string): boolean {
  return action === 'auth.login_failed' || action === 'quota.checks_paused';
}

/**
 * Whose record an entry is, which is how the page already describes itself:
 * sign-ins and password changes are yours, key and channel changes belong to
 * the project.
 */
export function auditScope(event: AuditEventDto): 'account' | 'project' {
  return event.action.startsWith('auth.') || event.action.startsWith('account.')
    ? 'account'
    : 'project';
}

export const auditRules: TableRules<AuditEventDto> = {
  /**
   * The label rather than the raw action, because "Sign-in failed" is what is
   * on the screen and therefore what someone will type. The raw action is in
   * here too, so an operator who knows the API can search for `auth.login`.
   */
  text: (event) => [
    event.occurredAt,
    auditLabel(event.action),
    event.action,
    event.actorEmail,
    event.actorIsApiKey ? 'api key' : '',
    event.targetLabel,
    event.ip,
  ],

  sortValue: (event, column) => {
    switch (column) {
      case 'action':
        return auditLabel(event.action);
      case 'actor':
        return (event.actorEmail ?? '').toLowerCase();
      case 'target':
        return (event.targetLabel ?? '').toLowerCase();
      case 'ip':
        return event.ip ?? '';
      default:
        return Date.parse(event.occurredAt);
    }
  },

  // Newest first. An audit trail is read from the end.
  compare: (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
};

import type { AuditEventDto } from '@silencewatch/shared';
import type { MessageKey } from '../../../../core/i18n/messages';
import type { Translate } from '../../../../core/i18n/i18n.service';
import type { TableRules } from '../../../../shared/data-table';

/**
 * The audit actions that have wording of their own. Anything else — an action a
 * newer server records that this build has never heard of — is shown as the raw
 * action rather than hidden.
 */
const AUDIT_ACTIONS = new Set<string>([
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
  'project.deleted',
  'quota.checks_paused',
]);

/** "auth.login_failed" reads as noise; "Sign-in failed" reads as a sentence. */
export function auditLabel(action: string, t: Translate): string {
  return AUDIT_ACTIONS.has(action) ? t(`audit.${action}` as MessageKey) : action;
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

export function auditRules(t: Translate): TableRules<AuditEventDto> {
  return {
    /**
     * The label rather than the raw action, because "Sign-in failed" is what is
     * on the screen and therefore what someone will type. The raw action is in
     * here too, so an operator who knows the API can search for `auth.login`.
     */
    text: (event) => [
      event.occurredAt,
      auditLabel(event.action, t),
      event.action,
      event.actorEmail,
      event.actorIsApiKey ? `api key ${t('settings.apiKeyTag')}` : '',
      event.targetLabel,
      event.ip,
    ],

    sortValue: (event, column) => {
      switch (column) {
        case 'action':
          return auditLabel(event.action, t);
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
}

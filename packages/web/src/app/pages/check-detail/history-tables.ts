import type { IncidentDto, PingDto } from '@silencewatch/shared';
import type { Translate } from '../../core/i18n/i18n.service';
import type { TableRules } from '../../shared/data-table';

/**
 * How the two history tables on a check sort and search.
 *
 * Both are logs, so both default to newest first: the question these tables
 * answer is "what just happened", and an ordering that puts the answer on the
 * last page answers it badly.
 */

/** How long an incident lasted, counting an unresolved one up to now. */
export function outageMs(incident: IncidentDto): number {
  const end = incident.resolvedAt === null ? Date.now() : Date.parse(incident.resolvedAt);
  return end - Date.parse(incident.startedAt);
}

export function pingRules(t: Translate): TableRules<PingDto> {
  return {
    /**
     * Includes the raw timestamp, so a date typed in narrows to that day, and the
     * exit code, so "127" finds the command that was not found. The body is in
     * here too: it is often the only thing that distinguishes two failures.
     */
    text: (ping) => [
      ping.receivedAt,
      ping.kind,
      kindWord(ping, t),
      ping.exitCode === null ? '' : String(ping.exitCode),
      ping.sourceIp,
      ping.body,
    ],

    sortValue: (ping, column) => {
      switch (column) {
        case 'kind':
          return ping.kind;
        case 'durationMs':
          // A ping that reported no duration sorts as the shortest rather than
          // being scattered through the middle.
          return ping.durationMs ?? -1;
        case 'exitCode':
          return ping.exitCode ?? -1;
        case 'sourceIp':
          return ping.sourceIp ?? '';
        default:
          return Date.parse(ping.receivedAt);
      }
    },

    compare: (left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
  };
}

/** The words on a ping's kind, in the language on screen. */
export function kindWord(ping: PingDto, t: Translate): string {
  switch (ping.kind) {
    case 'success':
      return t('detail.kindSuccess');
    case 'fail':
      return t('detail.kindFail');
    default:
      return t('detail.kindStart');
  }
}

export function incidentRules(t: Translate): TableRules<IncidentDto> {
  return {
    // "ongoing" and "resolved" are words on the screen, so they are words the
    // search box understands — in both languages.
    text: (incident) => [
      incident.startedAt,
      incident.resolvedAt,
      incident.resolvedAt === null ? 'ongoing' : 'resolved',
      incident.resolvedAt === null ? t('detail.ongoing') : t('detail.resolved'),
      String(incident.notificationsSent),
    ],

    sortValue: (incident, column) => {
      switch (column) {
        case 'resolvedAt':
          // An incident still running is the newest thing on the page, not a
          // blank to sort to the bottom.
          return incident.resolvedAt === null
            ? Number.MAX_SAFE_INTEGER
            : Date.parse(incident.resolvedAt);
        case 'duration':
          return outageMs(incident);
        case 'notificationsSent':
          return incident.notificationsSent;
        default:
          return Date.parse(incident.startedAt);
      }
    },

    compare: (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  };
}

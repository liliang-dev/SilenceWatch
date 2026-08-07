import type { IncidentDto, PingDto } from '@silencewatch/shared';
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

export const pingRules: TableRules<PingDto> = {
  /**
   * Includes the raw timestamp, so a date typed in narrows to that day, and the
   * exit code, so "127" finds the command that was not found. The body is in
   * here too: it is often the only thing that distinguishes two failures.
   */
  text: (ping) => [
    ping.receivedAt,
    ping.kind,
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

export const incidentRules: TableRules<IncidentDto> = {
  // "ongoing" and "resolved" are words on the screen, so they are words the
  // search box understands.
  text: (incident) => [
    incident.startedAt,
    incident.resolvedAt,
    incident.resolvedAt === null ? 'ongoing' : 'resolved',
    String(incident.notificationsSent),
  ],

  sortValue: (incident, column) => {
    switch (column) {
      case 'resolvedAt':
        // An incident still running is the newest thing on the page, not a
        // blank to sort to the bottom.
        return incident.resolvedAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(incident.resolvedAt);
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

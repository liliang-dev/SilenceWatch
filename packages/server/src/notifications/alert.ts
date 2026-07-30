import type { AlertKind, CheckState } from '@silencewatch/shared';

export interface AlertCheck {
  id: string;
  name: string;
  state: CheckState;
  environment: string | null;
  tags: string[];
  lastPingAt: Date | null;
  nextDueAt: Date | null;
  graceSeconds: number;
  scheduleType: 'interval' | 'cron';
  periodSeconds: number | null;
  cronExpression: string | null;
  timezone: string;
}

export interface AlertProject {
  id: string;
  name: string;
}

export interface AlertIncident {
  id: string;
  startedAt: Date;
  resolvedAt: Date | null;
  cause: string;
}

/** Everything a channel needs to render a message. Free of database concerns. */
export interface Alert {
  kind: AlertKind;
  check: AlertCheck;
  project: AlertProject;
  incident: AlertIncident;
  /** Deep link to the check in the web UI. */
  url: string;
}

export function describeSchedule(check: AlertCheck): string {
  if (check.scheduleType === 'cron') {
    return `cron "${check.cronExpression}" (${check.timezone})`;
  }
  return check.periodSeconds === null
    ? 'unknown schedule'
    : `every ${formatDuration(check.periodSeconds)}`;
}

/** Compact, human duration: 45s, 5m, 2h 30m, 3d 4h. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function downtimeSeconds(incident: AlertIncident, now = new Date()): number {
  const end = incident.resolvedAt ?? now;
  return Math.max(0, (end.getTime() - incident.startedAt.getTime()) / 1000);
}

export function formatInstant(value: Date | null): string {
  return value === null ? 'never' : value.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

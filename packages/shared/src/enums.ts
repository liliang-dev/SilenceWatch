/**
 * Domain enumerations shared by the server, the web UI and the client libraries.
 * Values are the exact strings persisted in PostgreSQL and exposed over the API.
 */

export const CHECK_STATES = ['NEW', 'UP', 'LATE', 'DOWN', 'PAUSED'] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const SCHEDULE_TYPES = ['interval', 'cron'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const PING_KINDS = ['start', 'success', 'fail'] as const;
export type PingKind = (typeof PING_KINDS)[number];

export const CHECK_SOURCES = ['manual', 'api', 'auto'] as const;
export type CheckSource = (typeof CHECK_SOURCES)[number];

export const CHANNEL_TYPES = ['email', 'webhook', 'slack', 'teams', 'discord'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const PROJECT_ROLES = ['owner', 'admin', 'member'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** States a check must be in for the detection loop to consider it. */
export const ACTIVE_CHECK_STATES: readonly CheckState[] = ['NEW', 'UP', 'LATE'];

/** Alert kinds emitted by the state machine. */
export const ALERT_KINDS = ['down', 'up'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

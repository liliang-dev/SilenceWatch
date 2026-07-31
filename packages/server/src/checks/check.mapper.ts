import type { Check, Incident, Ping } from '@prisma/client';
import type { CheckDto, IncidentDto, PingDto } from '@silencewatch/shared';

/** Row → DTO. The only place field naming crosses the wire boundary. */
export function toCheckDto(check: Check, baseUrl: string): CheckDto {
  return {
    id: check.id,
    projectId: check.projectId,
    name: check.name,
    slug: check.slug,
    key: check.key,
    pingKey: check.pingKey,
    pingUrl: `${baseUrl}/p/${check.pingKey}`,
    pingKeyRotatedAt: check.pingKeyRotatedAt?.toISOString() ?? null,
    pausedReason: check.pausedReason,
    scheduleType: check.scheduleType,
    periodSeconds: check.periodSeconds,
    cronExpression: check.cronExpression,
    timezone: check.timezone,
    graceSeconds: check.graceSeconds,
    state: check.state,
    lastPingAt: check.lastPingAt?.toISOString() ?? null,
    lastDurationMs: check.lastDurationMs,
    nextDueAt: check.nextDueAt?.toISOString() ?? null,
    source: check.source,
    environment: check.environment,
    tags: check.tags,
    description: check.description,
    orphanedAt: check.orphanedAt?.toISOString() ?? null,
    createdAt: check.createdAt.toISOString(),
    updatedAt: check.updatedAt.toISOString(),
  };
}

export function toPingDto(ping: Ping): PingDto {
  return {
    // BigInt would not survive JSON.stringify.
    id: ping.id.toString(),
    checkId: ping.checkId,
    receivedAt: ping.receivedAt.toISOString(),
    kind: ping.kind,
    exitCode: ping.exitCode,
    durationMs: ping.durationMs,
    body: ping.body,
    sourceIp: ping.sourceIp,
    userAgent: ping.userAgent,
  };
}

export function toIncidentDto(incident: Incident): IncidentDto {
  return {
    id: incident.id,
    checkId: incident.checkId,
    startedAt: incident.startedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    notificationsSent: incident.notificationsSent,
  };
}

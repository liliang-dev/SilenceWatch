import { randomUUID } from 'node:crypto';
import type { Alert } from '../notifications/alert';

/** The sample alert sent by a channel's "test" button: a plausible incident that is not real. */
export function buildTestAlert(project: { id: string; name: string }, baseUrl: string): Alert {
  const now = new Date();
  return {
    kind: 'down',
    project,
    check: {
      id: randomUUID(),
      name: 'SilenceWatch test check',
      state: 'DOWN',
      environment: 'test',
      tags: ['test'],
      lastPingAt: new Date(now.getTime() - 3_600_000),
      nextDueAt: new Date(now.getTime() - 600_000),
      graceSeconds: 300,
      scheduleType: 'cron',
      periodSeconds: null,
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
    },
    incident: { id: randomUUID(), startedAt: now, resolvedAt: null, cause: 'missed' },
    url: `${baseUrl}/projects/${project.id}`,
  };
}

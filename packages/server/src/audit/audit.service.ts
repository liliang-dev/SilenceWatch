import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditEventDto, PageDto } from '@silencewatch/shared';
import { PrismaService } from '../database/prisma.service';

export interface AuditActor {
  userId?: string | null;
  email?: string | null;
  apiKeyId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditRecord {
  action: AuditAction;
  actor: AuditActor;
  projectId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Human-readable name of the thing acted on, kept so the trail survives its deletion. */
  targetLabel?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * The record of who did what.
 *
 * Two properties make this worth having rather than a second log stream:
 *
 *  - **It outlives its subjects.** Actor and project are plain columns, not
 *    relations with a cascade. Deleting a user must not delete the evidence of
 *    what they did on the way out — which is precisely the moment the record
 *    matters most.
 *  - **It never breaks the thing it observes.** Writing an event is
 *    fire-and-forget: a failure is logged and swallowed. An audit trail that
 *    can fail a password change has turned a nice-to-have into an outage.
 *
 * What does *not* go in here: passwords, tokens, API keys, ping URLs, or the
 * contents of a notification channel's configuration. The trail is readable by
 * project admins, so anything secret in it would be a disclosure, not a record.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  /**
   * userId → email, so the common case (a request that knows who is acting but
   * not what they are called) does not cost a query per event. Bounded, and
   * only ever holding data the trail is about to store anyway.
   */
  private readonly emails = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Records an event. Never throws, and never blocks the request. */
  record(event: AuditRecord): void {
    void this.write(event).catch((error: unknown) =>
      this.logger.error(`Could not record audit event "${event.action}": ${String(error)}`),
    );
  }

  private async write(event: AuditRecord): Promise<void> {
    // The address is denormalised so the entry still reads correctly once the
    // account is gone. Callers that already have it pass it; the rest are
    // resolved here rather than by threading an email through every handler.
    const actorEmail = event.actor.email ?? (await this.resolveEmail(event.actor.userId));

    await this.prisma.auditEvent
      .create({
        data: {
          action: event.action,
          actorUserId: event.actor.userId ?? null,
          actorEmail,
          actorApiKeyId: event.actor.apiKeyId ?? null,
          projectId: event.projectId ?? null,
          targetType: event.targetType ?? null,
          targetId: event.targetId ?? null,
          targetLabel: event.targetLabel ?? null,
          ip: event.actor.ip ?? null,
          userAgent: event.actor.userAgent?.slice(0, 300) ?? null,
          detail: (event.detail ?? undefined) as never,
        },
      })
      // Swallowed here as well as by the caller: an audit trail that can fail a
      // password change has turned a nice-to-have into an outage.
      .catch((error: unknown) =>
        this.logger.error(`Could not record audit event "${event.action}": ${String(error)}`),
      );
  }

  private async resolveEmail(userId: string | null | undefined): Promise<string | null> {
    if (userId === null || userId === undefined) return null;

    const cached = this.emails.get(userId);
    if (cached !== undefined) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user === null) return null;

    // Plain cap rather than an LRU: entries are tiny, and the working set is
    // "people currently doing things", which is small by construction.
    if (this.emails.size > 5_000) this.emails.clear();
    this.emails.set(userId, user.email);
    return user.email;
  }

  /**
   * Events for a project, newest first.
   *
   * Keyset pagination on the id, like every other list in this API: an offset
   * would drift as new events arrive underneath the reader.
   */
  async listForProject(
    projectId: string,
    limit: number,
    cursor?: string,
  ): Promise<PageDto<AuditEventDto>> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        projectId,
        ...(cursor === undefined ? {} : { id: { lt: BigInt(cursor) } }),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id.toString() ?? null) : null,
    };
  }

  /**
   * Events about an account itself — sign-ins, password changes — which belong
   * to no project and are therefore invisible in the project view.
   */
  async listForUser(userId: string, limit: number, cursor?: string): Promise<PageDto<AuditEventDto>> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        actorUserId: userId,
        projectId: null,
        ...(cursor === undefined ? {} : { id: { lt: BigInt(cursor) } }),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id.toString() ?? null) : null,
    };
  }

  /** Drops events past the retention window. Called by the retention job. */
  async purge(retentionDays: number): Promise<number> {
    const { count } = await this.prisma.auditEvent.deleteMany({
      where: { occurredAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
    });
    return count;
  }
}

function toDto(row: {
  id: bigint;
  occurredAt: Date;
  action: string;
  actorEmail: string | null;
  actorApiKeyId: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  detail: unknown;
}): AuditEventDto {
  return {
    id: row.id.toString(),
    occurredAt: row.occurredAt.toISOString(),
    action: row.action as AuditAction,
    actorEmail: row.actorEmail,
    // Whether a machine or a person did it is the first thing a reader wants.
    actorIsApiKey: row.actorApiKeyId !== null,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    ip: row.ip,
    detail: (row.detail ?? null) as Record<string, unknown> | null,
  };
}

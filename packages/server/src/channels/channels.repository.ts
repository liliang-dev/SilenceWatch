import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@prisma/client';
import type { ChannelType } from '@silencewatch/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { ChannelConfigError, ChannelConfigVault } from '../notifications/channel-config.vault';
import type { QuotaDb } from '../quotas/quota.service';

export type ChannelRow = NotificationChannel;

export interface ChannelWithProject extends ChannelRow {
  project: { id: string; name: string };
}

export interface NewChannel {
  projectId: string;
  type: ChannelType;
  name: string;
  config: Prisma.InputJsonValue;
}

/**
 * Every query on notification channels. Each one that takes an id also takes
 * the project, so a channel is never reached through another project's id.
 *
 * A channel's configuration is sealed in the database (see ChannelConfigVault): it
 * is sealed on its way in and opened on its way out, so callers only ever see the
 * plain configuration, and the database never does.
 */
@Injectable()
export class ChannelsRepository {
  private readonly logger = new Logger(ChannelsRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: ChannelConfigVault,
  ) {}

  async listForProject(projectId: string): Promise<ChannelRow[]> {
    const rows = await this.prisma.notificationChannel.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.opened(row));
  }

  async create(input: NewChannel, db: QuotaDb = this.prisma): Promise<ChannelRow> {
    // The id is chosen here, not by the database, because it is part of what is sealed.
    const id = randomUUID();
    const row = await db.notificationChannel.create({
      data: { ...input, id, config: this.vault.seal(id, input.config) },
    });
    return this.opened(row);
  }

  async findInProject(projectId: string, channelId: string): Promise<ChannelRow | null> {
    const row = await this.prisma.notificationChannel.findFirst({ where: { id: channelId, projectId } });
    return row === null ? null : this.opened(row);
  }

  async findWithProject(projectId: string, channelId: string): Promise<ChannelWithProject | null> {
    const row = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, projectId },
      include: { project: { select: { id: true, name: true } } },
    });
    return row === null ? null : this.opened(row);
  }

  /**
   * The row with its configuration opened. A configuration that cannot be opened
   * (another SECRET_KEY, a damaged row) is shown as empty rather than failing the page
   * that lists the channels: the channel still can be renamed and deleted, and the
   * alert it cannot send says why in the delivery's error.
   */
  private opened<T extends ChannelRow>(row: T): T {
    try {
      return { ...row, config: this.vault.open(row.id, row.config) as ChannelRow['config'] };
    } catch (error) {
      if (!(error instanceof ChannelConfigError)) throw error;
      this.logger.warn(`Channel ${row.id}: ${error.message}`);
      return { ...row, config: {} };
    }
  }

  /** Null when the channel is not in that project. */
  async update(
    projectId: string,
    channelId: string,
    patch: { name?: string; enabled?: boolean },
  ): Promise<ChannelRow | null> {
    const updated = await this.prisma.notificationChannel.updateMany({
      where: { id: channelId, projectId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      },
    });
    if (updated.count === 0) return null;
    return this.opened(await this.prisma.notificationChannel.findUniqueOrThrow({ where: { id: channelId } }));
  }

  /**
   * Takes the right to send a test alert, in one statement: the channel is marked
   * as tested only if it was not tested within the cooldown, so two requests
   * arriving together cannot both go through.
   *
   * Returns 0 when the test may go ahead, and otherwise the seconds to wait.
   */
  async claimTest(projectId: string, channelId: string, cooldownSeconds: number): Promise<number> {
    const now = new Date();
    const claimed = await this.prisma.notificationChannel.updateMany({
      where: {
        id: channelId,
        projectId,
        OR: [
          { lastTestedAt: null },
          { lastTestedAt: { lt: new Date(now.getTime() - cooldownSeconds * 1000) } },
        ],
      },
      data: { lastTestedAt: now },
    });
    if (claimed.count > 0) return 0;

    const channel = await this.findInProject(projectId, channelId);
    if (channel?.lastTestedAt == null) return 0;
    const wait = cooldownSeconds * 1000 - (now.getTime() - channel.lastTestedAt.getTime());
    return Math.max(1, Math.ceil(wait / 1000));
  }

  /** Whether a channel was deleted. */
  async delete(projectId: string, channelId: string): Promise<boolean> {
    const deleted = await this.prisma.notificationChannel.deleteMany({
      where: { id: channelId, projectId },
    });
    return deleted.count > 0;
  }
}

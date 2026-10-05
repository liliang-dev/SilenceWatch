import { Injectable } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@prisma/client';
import type { ChannelType } from '@silencewatch/shared';
import { PrismaService } from '../database/prisma.service';

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
 */
@Injectable()
export class ChannelsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForProject(projectId: string): Promise<ChannelRow[]> {
    return this.prisma.notificationChannel.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(input: NewChannel): Promise<ChannelRow> {
    return this.prisma.notificationChannel.create({ data: input });
  }

  findInProject(projectId: string, channelId: string): Promise<ChannelRow | null> {
    return this.prisma.notificationChannel.findFirst({ where: { id: channelId, projectId } });
  }

  findWithProject(projectId: string, channelId: string): Promise<ChannelWithProject | null> {
    return this.prisma.notificationChannel.findFirst({
      where: { id: channelId, projectId },
      include: { project: { select: { id: true, name: true } } },
    });
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
    return this.prisma.notificationChannel.findUniqueOrThrow({ where: { id: channelId } });
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

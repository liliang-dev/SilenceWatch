import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import type {
  ChannelType,
  CreateChannelRequest,
  NotificationChannelDto,
  UpdateChannelRequest,
} from '@silencewatch/shared';
import { randomUUID } from 'node:crypto';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { QuotaService } from '../quotas/quota.service';
import type { Alert } from '../notifications/alert';
import { SafeHttpService } from '../notifications/safe-http.service';
import { SenderRegistry } from '../notifications/sender.registry';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly senders: SenderRegistry,
    private readonly http: SafeHttpService,
    private readonly quotas: QuotaService,
  ) {}

  async list(projectId: string): Promise<NotificationChannelDto[]> {
    const channels = await this.prisma.notificationChannel.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map(toDto);
  }

  async create(projectId: string, input: CreateChannelRequest): Promise<NotificationChannelDto> {
    await this.quotas.assertCanAddChannel(projectId);

    // Reject a target that could never work — or that points inside our own
    // network — now rather than at 3am.
    if (input.type !== 'email') {
      await this.http.assertTargetIsAllowed(input.config.url).catch((error: Error) => {
        throw new BadRequestException(`Channel target rejected: ${error.message}`);
      });
    }

    const channel = await this.prisma.notificationChannel.create({
      data: {
        projectId,
        type: input.type,
        name: input.name,
        config: input.config,
      },
    });
    return toDto(channel);
  }

  async update(
    projectId: string,
    channelId: string,
    input: UpdateChannelRequest,
  ): Promise<NotificationChannelDto> {
    const updated = await this.prisma.notificationChannel.updateMany({
      where: { id: channelId, projectId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
    if (updated.count === 0) throw new NotFoundException('Channel not found');

    const channel = await this.prisma.notificationChannel.findUniqueOrThrow({
      where: { id: channelId },
    });
    return toDto(channel);
  }

  /** One channel, or 404. Used by callers that need its name before deleting it. */
  async get(projectId: string, channelId: string): Promise<NotificationChannelDto> {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, projectId },
    });
    if (channel === null) throw new NotFoundException('Channel not found');
    return toDto(channel);
  }

  async remove(projectId: string, channelId: string): Promise<void> {
    const deleted = await this.prisma.notificationChannel.deleteMany({
      where: { id: channelId, projectId },
    });
    if (deleted.count === 0) throw new NotFoundException('Channel not found');
  }

  /**
   * Sends a sample alert straight away — no queue, no retry — and reports the
   * failure verbatim. Configuring an alerting channel without being able to try
   * it means discovering it is broken during an incident.
   */
  async sendTest(projectId: string, channelId: string): Promise<void> {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, projectId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (channel === null) throw new NotFoundException('Channel not found');

    try {
      await this.senders.get(channel.type).send(this.buildTestAlert(channel.project), channel.config);
    } catch (error) {
      throw new BadRequestException(`Test delivery failed: ${(error as Error).message}`);
    }
  }

  private buildTestAlert(project: { id: string; name: string }): Alert {
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
      url: `${this.config.baseUrl}/projects/${project.id}`,
    };
  }
}

/**
 * Channel configuration holds secrets: signing secrets, and webhook URLs whose
 * path *is* the credential (Slack, Discord, Teams). The API therefore never
 * returns `config` — only a masked hint good enough to tell two channels apart.
 */
function toDto(channel: NotificationChannel): NotificationChannelDto {
  return {
    id: channel.id,
    projectId: channel.projectId,
    type: channel.type,
    name: channel.name,
    enabled: channel.enabled,
    target: maskTarget(channel.type, channel.config),
    createdAt: channel.createdAt.toISOString(),
  };
}

function maskTarget(type: ChannelType, config: unknown): string {
  const record = (config ?? {}) as Record<string, unknown>;

  if (type === 'email') {
    return typeof record.address === 'string' ? record.address : '—';
  }
  if (typeof record.url !== 'string') return '—';

  try {
    const url = new URL(record.url);
    const [, firstSegment] = url.pathname.split('/');
    const hasMore = url.pathname.replace(/^\/+/, '').includes('/');
    const shown = firstSegment === undefined || firstSegment === '' ? '' : `/${firstSegment}`;
    return `${url.host}${shown}${hasMore ? '/…' : ''}`;
  } catch {
    return '—';
  }
}

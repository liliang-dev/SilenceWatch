import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateChannelRequest,
  NotificationChannelDto,
  UpdateChannelRequest,
} from '@silencewatch/shared';
import { AppConfig, CONFIG } from '../config/config';
import { SafeHttpService } from '../notifications/safe-http.service';
import { SenderRegistry } from '../notifications/sender.registry';
import { QuotaService } from '../quotas/quota.service';
import { toChannelDto } from './channel.mapper';
import { ChannelsRepository } from './channels.repository';
import { buildTestAlert } from './test-alert';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly channels: ChannelsRepository,
    private readonly senders: SenderRegistry,
    private readonly http: SafeHttpService,
    private readonly quotas: QuotaService,
  ) {}

  async list(projectId: string): Promise<NotificationChannelDto[]> {
    return (await this.channels.listForProject(projectId)).map(toChannelDto);
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

    return toChannelDto(
      await this.channels.create({
        projectId,
        type: input.type,
        name: input.name,
        config: input.config,
      }),
    );
  }

  async update(
    projectId: string,
    channelId: string,
    input: UpdateChannelRequest,
  ): Promise<NotificationChannelDto> {
    const channel = await this.channels.update(projectId, channelId, input);
    if (channel === null) throw new NotFoundException('Channel not found');
    return toChannelDto(channel);
  }

  /** One channel, or 404. Used by callers that need its name before deleting it. */
  async get(projectId: string, channelId: string): Promise<NotificationChannelDto> {
    const channel = await this.channels.findInProject(projectId, channelId);
    if (channel === null) throw new NotFoundException('Channel not found');
    return toChannelDto(channel);
  }

  async remove(projectId: string, channelId: string): Promise<void> {
    if (!(await this.channels.delete(projectId, channelId))) {
      throw new NotFoundException('Channel not found');
    }
  }

  /**
   * Sends a sample alert straight away — no queue, no retry — and reports the
   * failure verbatim. Configuring an alerting channel without being able to try
   * it means discovering it is broken during an incident.
   */
  async sendTest(projectId: string, channelId: string): Promise<void> {
    const channel = await this.channels.findWithProject(projectId, channelId);
    if (channel === null) throw new NotFoundException('Channel not found');

    try {
      await this.senders
        .get(channel.type)
        .send(buildTestAlert(channel.project, this.config.baseUrl), channel.config);
    } catch (error) {
      throw new BadRequestException(`Test delivery failed: ${(error as Error).message}`);
    }
  }
}

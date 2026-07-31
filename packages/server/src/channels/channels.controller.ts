import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  createChannelRequestSchema,
  updateChannelRequestSchema,
  type NotificationChannelDto,
} from '@silencewatch/shared';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { auditActor } from '../audit/audit-actor';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { ProjectAccessService } from '../auth/project-access.service';
import { zodPipe } from '../common/zod-validation.pipe';
import { ChannelsService } from './channels.service';

@Controller('v1/projects/:projectId/channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<NotificationChannelDto[]> {
    await this.access.assertAccess(principal, projectId);
    return this.channels.list(projectId);
  }

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodPipe(createChannelRequestSchema)) body: z.infer<typeof createChannelRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<NotificationChannelDto> {
    // Who gets alerted is a security-relevant setting.
    await this.access.assertAccess(principal, projectId, 'admin');
    const channel = await this.channels.create(projectId, body);

    // The target is recorded, the config is not: a webhook config carries a
    // signing secret, and the trail is readable by every admin on the project.
    this.audit.record({
      action: 'channel.created',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'channel',
      targetId: channel.id,
      targetLabel: channel.name,
      detail: { type: channel.type, target: channel.target },
    });
    return channel;
  }

  @Patch(':channelId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body(zodPipe(updateChannelRequestSchema)) body: z.infer<typeof updateChannelRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<NotificationChannelDto> {
    await this.access.assertAccess(principal, projectId, 'admin');
    const channel = await this.channels.update(projectId, channelId, body);

    this.audit.record({
      action: 'channel.updated',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'channel',
      targetId: channelId,
      targetLabel: channel.name,
      // Silencing a channel is the change most worth being able to find later.
      detail: { enabled: channel.enabled },
    });
    return channel;
  }

  @Delete(':channelId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.access.assertAccess(principal, projectId, 'admin');
    // Read before the delete: afterwards there is no name left to record.
    const doomed = await this.channels.get(projectId, channelId);
    await this.channels.remove(projectId, channelId);

    this.audit.record({
      action: 'channel.deleted',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'channel',
      targetId: channelId,
      targetLabel: doomed.name,
      detail: { type: doomed.type, target: doomed.target },
    });
  }

  @Post(':channelId/test')
  @HttpCode(204)
  async test(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.access.assertAccess(principal, projectId, 'admin');
    await this.channels.sendTest(projectId, channelId);

    this.audit.record({
      action: 'channel.tested',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'channel',
      targetId: channelId,
    });
  }
}

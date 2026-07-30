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
} from '@nestjs/common';
import {
  createChannelRequestSchema,
  updateChannelRequestSchema,
  type NotificationChannelDto,
} from '@silencewatch/shared';
import type { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { ProjectAccessService } from '../auth/project-access.service';
import { zodPipe } from '../common/zod-validation.pipe';
import { ChannelsService } from './channels.service';

@Controller('v1/projects/:projectId/channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly access: ProjectAccessService,
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
  ): Promise<NotificationChannelDto> {
    // Who gets alerted is a security-relevant setting.
    await this.access.assertAccess(principal, projectId, 'admin');
    return this.channels.create(projectId, body);
  }

  @Patch(':channelId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body(zodPipe(updateChannelRequestSchema)) body: z.infer<typeof updateChannelRequestSchema>,
  ): Promise<NotificationChannelDto> {
    await this.access.assertAccess(principal, projectId, 'admin');
    return this.channels.update(projectId, channelId, body);
  }

  @Delete(':channelId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<void> {
    await this.access.assertAccess(principal, projectId, 'admin');
    await this.channels.remove(projectId, channelId);
  }

  @Post(':channelId/test')
  @HttpCode(204)
  async test(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<void> {
    await this.access.assertAccess(principal, projectId, 'admin');
    await this.channels.sendTest(projectId, channelId);
  }
}

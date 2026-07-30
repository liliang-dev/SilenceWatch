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
  createApiKeyRequestSchema,
  createProjectRequestSchema,
  updateProjectRequestSchema,
  type ApiKeyDto,
  type CreatedApiKeyDto,
  type ProjectDto,
} from '@silencewatch/shared';
import type { z } from 'zod';
import { ApiKeyService } from '../auth/api-key.service';
import { assertUser, CurrentPrincipal, type Principal } from '../auth/principal';
import { ProjectAccessService } from '../auth/project-access.service';
import { zodPipe } from '../common/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@Controller('v1/projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly apiKeys: ApiKeyService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<ProjectDto[]> {
    return this.projects.listForPrincipal(principal);
  }

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(createProjectRequestSchema)) body: z.infer<typeof createProjectRequestSchema>,
  ): Promise<ProjectDto> {
    return this.projects.create(assertUser(principal).userId, body);
  }

  @Get(':projectId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectDto> {
    await this.access.assertAccess(principal, projectId);
    return this.projects.get(projectId);
  }

  @Patch(':projectId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodPipe(updateProjectRequestSchema)) body: z.infer<typeof updateProjectRequestSchema>,
  ): Promise<ProjectDto> {
    await this.access.assertAccess(principal, projectId, 'admin');
    return this.projects.update(projectId, body);
  }

  @Delete(':projectId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    // Destroys every check and all history: owner only.
    await this.access.assertAccess(principal, projectId, 'owner');
    await this.projects.remove(projectId);
  }

  /* ------------------------------------------------------------ api keys --- */

  @Get(':projectId/api-keys')
  async listKeys(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ApiKeyDto[]> {
    // API keys must not be able to enumerate or mint other API keys.
    assertUser(principal);
    await this.access.assertAccess(principal, projectId, 'admin');
    return this.apiKeys.list(projectId);
  }

  @Post(':projectId/api-keys')
  async createKey(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodPipe(createApiKeyRequestSchema)) body: z.infer<typeof createApiKeyRequestSchema>,
  ): Promise<CreatedApiKeyDto> {
    assertUser(principal);
    await this.access.assertAccess(principal, projectId, 'admin');
    return this.apiKeys.create(projectId, body);
  }

  @Delete(':projectId/api-keys/:apiKeyId')
  @HttpCode(204)
  async revokeKey(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
  ): Promise<void> {
    assertUser(principal);
    await this.access.assertAccess(principal, projectId, 'admin');
    await this.apiKeys.revoke(projectId, apiKeyId);
  }
}

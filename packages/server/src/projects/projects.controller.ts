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
  createApiKeyRequestSchema,
  createProjectRequestSchema,
  updateProjectRequestSchema,
  type ApiKeyDto,
  type CreatedApiKeyDto,
  type ProjectDto,
} from '@silencewatch/shared';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { auditActor } from '../audit/audit-actor';
import { AuditService } from '../audit/audit.service';
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
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<ProjectDto[]> {
    return this.projects.listForPrincipal(principal);
  }

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(createProjectRequestSchema)) body: z.infer<typeof createProjectRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<ProjectDto> {
    const project = await this.projects.create(assertUser(principal).userId, body);
    this.audit.record({
      action: 'project.created',
      actor: auditActor(principal, request),
      projectId: project.id,
      targetType: 'project',
      targetId: project.id,
      targetLabel: project.name,
    });
    return project;
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
    @Req() request: FastifyRequest,
  ): Promise<ProjectDto> {
    await this.access.assertAccess(principal, projectId, 'admin');
    const project = await this.projects.update(projectId, body);

    this.audit.record({
      action: 'project.updated',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'project',
      targetId: projectId,
      targetLabel: project.name,
      // Shortening retention destroys history; it is the change worth finding.
      detail: { name: project.name, pingRetentionDays: project.pingRetentionDays },
    });
    return project;
  }

  @Delete(':projectId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    // Destroys every check and all history: owner only.
    await this.access.assertAccess(principal, projectId, 'owner');
    // Read first: afterwards there is no name left to say what was destroyed.
    const doomed = await this.projects.get(projectId);
    await this.projects.remove(projectId);

    this.audit.record({
      action: 'project.deleted',
      actor: auditActor(principal, request),
      // Deliberately not filed under the project: that trail is only readable
      // through the project, and the project is what just ceased to exist. It
      // belongs to the account, which is where its owner can still find it.
      projectId: null,
      targetType: 'project',
      targetId: projectId,
      targetLabel: doomed.name,
      detail: { slug: doomed.slug, checkCount: doomed.checkCount ?? 0 },
    });
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
    @Req() request: FastifyRequest,
  ): Promise<CreatedApiKeyDto> {
    assertUser(principal);
    await this.access.assertAccess(principal, projectId, 'admin');
    const created = await this.apiKeys.create(projectId, body);

    // The prefix, never the token. A trail that quotes the credential it is
    // recording the creation of has handed it to every admin who can read it.
    this.audit.record({
      action: 'api_key.created',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'api_key',
      targetId: created.id,
      targetLabel: created.name,
      detail: { prefix: created.prefix },
    });
    return created;
  }

  @Delete(':projectId/api-keys/:apiKeyId')
  @HttpCode(204)
  async revokeKey(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    assertUser(principal);
    await this.access.assertAccess(principal, projectId, 'admin');
    await this.apiKeys.revoke(projectId, apiKeyId);

    this.audit.record({
      action: 'api_key.revoked',
      actor: auditActor(principal, request),
      projectId,
      targetType: 'api_key',
      targetId: apiKeyId,
    });
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createCheckRequestSchema,
  listChecksQuerySchema,
  syncRequestSchema,
  updateCheckRequestSchema,
  type CheckDto,
  type IncidentDto,
  type PageDto,
  type PingDto,
  type SyncResultDto,
} from '@silencewatch/shared';
import { z } from 'zod';
import { ProjectAccessService } from '../auth/project-access.service';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { zodPipe } from '../common/zod-validation.pipe';
import { CheckSyncService } from './check-sync.service';
import { ChecksService } from './checks.service';

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
});

@Controller('v1')
export class ChecksController {
  constructor(
    private readonly checks: ChecksService,
    private readonly sync: CheckSyncService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('checks')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(zodPipe(listChecksQuerySchema)) query: z.infer<typeof listChecksQuerySchema>,
  ): Promise<PageDto<CheckDto>> {
    const projectIds = await this.access.visibleProjectIds(principal);
    return this.checks.list(projectIds, query);
  }

  @Get('projects/:projectId/checks')
  async listForProject(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query(zodPipe(listChecksQuerySchema)) query: z.infer<typeof listChecksQuerySchema>,
  ): Promise<PageDto<CheckDto>> {
    await this.access.assertAccess(principal, projectId);
    return this.checks.list([projectId], query);
  }

  @Post('projects/:projectId/checks')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodPipe(createCheckRequestSchema)) body: z.infer<typeof createCheckRequestSchema>,
  ): Promise<CheckDto> {
    await this.access.assertAccess(principal, projectId);
    return this.checks.create(projectId, body);
  }

  /**
   * Bulk declaration used by the client starters. An API key implies its project;
   * a user session must say which project it means.
   */
  @Post('checks/sync')
  @HttpCode(200)
  async syncChecks(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(syncRequestSchema)) body: z.infer<typeof syncRequestSchema>,
    @Query('projectId') projectIdQuery?: string,
  ): Promise<SyncResultDto> {
    const projectId = principal.kind === 'apiKey' ? principal.projectId : projectIdQuery;
    if (projectId === undefined) {
      throw new BadRequestException('projectId query parameter is required for user sessions');
    }
    if (!z.string().uuid().safeParse(projectId).success) {
      throw new BadRequestException('projectId must be a UUID');
    }

    await this.access.assertAccess(principal, projectId);
    return this.sync.sync(projectId, body);
  }

  @Get('checks/:checkId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('checkId', ParseUUIDPipe) checkId: string,
  ): Promise<CheckDto> {
    await this.access.assertCheckAccess(principal, checkId);
    return this.checks.get(checkId);
  }

  @Patch('checks/:checkId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body(zodPipe(updateCheckRequestSchema)) body: z.infer<typeof updateCheckRequestSchema>,
  ): Promise<CheckDto> {
    await this.access.assertCheckAccess(principal, checkId);
    return this.checks.update(checkId, body);
  }

  @Delete('checks/:checkId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('checkId', ParseUUIDPipe) checkId: string,
  ): Promise<void> {
    await this.access.assertCheckAccess(principal, checkId, 'admin');
    await this.checks.remove(checkId);
  }

  @Get('checks/:checkId/pings')
  async pings(
    @CurrentPrincipal() principal: Principal,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Query(zodPipe(historyQuerySchema)) query: z.infer<typeof historyQuerySchema>,
  ): Promise<PageDto<PingDto>> {
    await this.access.assertCheckAccess(principal, checkId);
    return this.checks.listPings(checkId, query.limit, query.cursor);
  }

  @Get('checks/:checkId/incidents')
  async incidents(
    @CurrentPrincipal() principal: Principal,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Query(zodPipe(historyQuerySchema)) query: z.infer<typeof historyQuerySchema>,
  ): Promise<PageDto<IncidentDto>> {
    await this.access.assertCheckAccess(principal, checkId);
    return this.checks.listIncidents(checkId, query.limit, query.cursor);
  }
}

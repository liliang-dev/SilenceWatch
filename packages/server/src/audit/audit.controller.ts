import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuditEventDto, PageDto } from '@silencewatch/shared';
import { assertUser, CurrentPrincipal, type Principal } from '../auth/principal';
import { ProjectAccessService } from '../auth/project-access.service';
import { AuditService } from './audit.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reading the audit trail.
 *
 * Project events need the **admin** role, not membership. The trail contains
 * addresses, user agents and who did what to whose alerting — enough to be
 * uncomfortable in the hands of every member of a shared project, and the
 * people who need it are the ones already trusted with the project's keys.
 *
 * API keys cannot read it at all. A leaked key must not become a way to find
 * out who has been signing in and from where.
 */
@Controller('v1')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:projectId/audit')
  async listForProject(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PageDto<AuditEventDto>> {
    assertUser(principal);
    await this.access.assertAccess(principal, projectId, 'admin');
    return this.audit.listForProject(projectId, parseLimit(limit), parseCursor(cursor));
  }

  /** Sign-ins, password changes — the events that belong to no project. */
  @Get('account/audit')
  async listForAccount(
    @CurrentPrincipal() principal: Principal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PageDto<AuditEventDto>> {
    const user = assertUser(principal);
    return this.audit.listForUser(user.userId, parseLimit(limit), parseCursor(cursor));
  }
}

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * The cursor reaches `BigInt()`, which throws on anything that is not a run of
 * digits — an uncaught SyntaxError, and a 500 where a first page was meant.
 * Anything unusable is treated as no cursor at all.
 */
function parseCursor(raw: string | undefined): string | undefined {
  return raw !== undefined && /^\d{1,19}$/.test(raw) ? raw : undefined;
}

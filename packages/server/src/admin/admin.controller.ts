import { Controller, Get, Header } from '@nestjs/common';
import type { AdminStatsDto } from '@silencewatch/shared';
import { CurrentPrincipal, type Principal } from '../access/principal';
import { AdminStatsService } from './admin-stats.service';
import { AdministratorService } from './administrator.service';

/**
 * The administrator's routes. Each one starts with AdministratorService.assert:
 * a session of the account ADMIN_EMAIL names, or 404 (401 for an API key).
 */
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly administrator: AdministratorService,
    private readonly stats: AdminStatsService,
  ) {}

  @Get('stats')
  @Header('cache-control', 'no-store')
  async getStats(@CurrentPrincipal() principal: Principal): Promise<AdminStatsDto> {
    await this.administrator.assert(principal);
    return this.stats.stats();
  }
}

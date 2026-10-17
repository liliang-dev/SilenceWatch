import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { UserDto } from '@silencewatch/shared';
import type { FastifyRequest } from 'fastify';
import { assertRecentUser, assertUser, CurrentPrincipal, type Principal } from '../../access/principal';
import { StrictRateLimit } from '../../common/rate-limit.guard';
import { originOfRequest } from '../better-auth/auth-policy';
import { AccountService } from './account.service';

@Controller('auth')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('me')
  async me(@CurrentPrincipal() principal: Principal): Promise<UserDto> {
    return this.account.get(assertUser(principal).userId);
  }

  /**
   * Deletes the signed-in account and its data, at once. See AccountService.
   *
   * A POST rather than a DELETE: it is not a resource of its own to remove, and a
   * proxy is free to treat DELETE oddly. The session's cookie is cleared by the
   * browser's next request, which the server no longer honours.
   */
  @StrictRateLimit()
  @Post('delete-account')
  @HttpCode(204)
  async deleteAccount(
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.account.delete(assertRecentUser(principal).userId, originOfRequest(request));
  }
}

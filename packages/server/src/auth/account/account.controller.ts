import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { deleteAccountRequestSchema, type UserDto } from '@silencewatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { assertUser, CurrentPrincipal, type Principal } from '../../access/principal';
import { StrictRateLimit } from '../../common/rate-limit.guard';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AppConfig, CONFIG } from '../../config/config';
import { sessionContextOf } from '../session-context';
import { clearRefreshCookie } from '../sessions/refresh-cookie';
import { AccountService } from './account.service';

@Controller('auth')
export class AccountController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly account: AccountService,
  ) {}

  @Get('me')
  async me(@CurrentPrincipal() principal: Principal): Promise<UserDto> {
    return this.account.get(assertUser(principal).userId);
  }

  /**
   * Deletes the signed-in account and its data, at once. See AccountService.
   *
   * A POST rather than a DELETE with a body: some proxies drop a body on DELETE,
   * and this one carries the password. Rate-limited like the other routes that
   * take a password, since it is one more place to guess it.
   */
  @StrictRateLimit()
  @Post('delete-account')
  @HttpCode(204)
  async deleteAccount(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(deleteAccountRequestSchema)) body: { password: string },
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.account.delete(assertUser(principal).userId, body, sessionContextOf(request));
    clearRefreshCookie(reply, this.config);
  }
}

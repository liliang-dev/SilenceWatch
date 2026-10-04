import { Body, Controller, HttpCode, Post, Req, Res, Inject } from '@nestjs/common';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
} from '@silencewatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../access/auth.guard';
import { assertUser, CurrentPrincipal, type Principal } from '../../access/principal';
import { StrictRateLimit } from '../../common/rate-limit.guard';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AppConfig, CONFIG } from '../../config/config';
import { clearRefreshCookie } from '../sessions/refresh-cookie';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';

/** Changing a password, and getting one back. */
@Controller('auth')
export class PasswordController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly resets: PasswordResetService,
  ) {}

  /**
   * Starts a password reset. Always 204 — see PasswordResetService for why the
   * answer cannot depend on whether the address exists.
   */
  @Public()
  @StrictRateLimit()
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(
    @Body(zodPipe(forgotPasswordRequestSchema)) body: { email: string },
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.resets.request(body.email, request.ip ?? null);
  }

  /**
   * Completes it. A POST, not the GET the emailed link points at: mail scanners
   * fetch every URL they see, and a single-use token behind a GET is spent
   * before the recipient reads the message.
   */
  @Public()
  @StrictRateLimit()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @Body(zodPipe(resetPasswordRequestSchema)) body: { token: string; newPassword: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.resets.complete(body.token, body.newPassword);
    clearRefreshCookie(reply, this.config);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(changePasswordRequestSchema))
    body: { currentPassword: string; newPassword: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.passwords.change(assertUser(principal).userId, body);
    clearRefreshCookie(reply, this.config);
  }
}

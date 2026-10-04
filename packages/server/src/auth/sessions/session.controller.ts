import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  loginRequestSchema,
  refreshRequestSchema,
  type LoginRequest,
  type SessionDto,
} from '@silencewatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../access/auth.guard';
import { StrictRateLimit } from '../../common/rate-limit.guard';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AppConfig, CONFIG } from '../../config/config';
import { sessionContextOf } from '../session-context';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './refresh-cookie';
import { SessionService } from './session.service';

/** Signing in, keeping a session alive, and signing out. */
@Controller('auth')
export class SessionController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @StrictRateLimit()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionDto> {
    const session = await this.sessions.login(body, sessionContextOf(request));
    setRefreshCookie(reply, this.config, session.refreshToken);
    return session;
  }

  /**
   * Public because the access token is, by definition, expired when this is
   * called; the refresh token is the credential.
   *
   * For a browser that credential is the HttpOnly cookie and the body is empty.
   * It is also how the SPA discovers on load whether it has a session at all,
   * since it can no longer look in localStorage — a 401 here means "signed out".
   */
  @Public()
  @StrictRateLimit()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(zodPipe(refreshRequestSchema)) body: { refreshToken?: string },
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionDto> {
    const presented = readRefreshToken(request, body);
    if (presented === null) {
      clearRefreshCookie(reply, this.config);
      throw new UnauthorizedException('Missing refresh token');
    }

    const session = await this.sessions
      .refresh(presented, sessionContextOf(request))
      .catch((error: unknown) => {
        clearRefreshCookie(reply, this.config);
        throw error;
      });

    setRefreshCookie(reply, this.config, session.refreshToken);
    return session;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(zodPipe(refreshRequestSchema)) body: { refreshToken?: string },
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const presented = readRefreshToken(request, body);
    clearRefreshCookie(reply, this.config);
    if (presented !== null) await this.sessions.logout(presented, sessionContextOf(request));
  }
}

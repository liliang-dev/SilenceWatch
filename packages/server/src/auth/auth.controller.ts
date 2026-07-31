import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  type RegisterResponse,
  type SessionDto,
  type SignupChallengeDto,
  type UserDto,
} from '@silencewatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StrictRateLimit } from '../common/rate-limit.guard';
import { AppConfig, CONFIG } from '../config/config';
import { zodPipe } from '../common/zod-validation.pipe';
import { Public } from './auth.guard';
import { AuthService, type SessionContext } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { assertUser, CurrentPrincipal, type Principal } from './principal';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './refresh-cookie';
import { SignupChallengeService } from './signup-challenge.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly verification: EmailVerificationService,
    private readonly challenge: SignupChallengeService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /**
   * The work this instance wants before it will accept a registration.
   *
   * Public and unauthenticated by necessity, so it is deliberately stateless:
   * see SignupChallengeService. `difficulty: 0` means "none", and a client that
   * gets it submits without a solution.
   */
  @Public()
  @StrictRateLimit()
  @Get('signup-challenge')
  signupChallenge(@Req() request: FastifyRequest): SignupChallengeDto {
    return this.challenge.issue(SignupChallengeService.networkOf(request.ip));
  }

  @Public()
  @StrictRateLimit()
  @Post('register')
  async register(
    @Body(zodPipe(registerRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RegisterResponse> {
    const result = await this.auth.register(
      body as Parameters<AuthService['register']>[0],
      sessionContext(request),
    );
    if (result.status === 'active') setRefreshCookie(reply, this.config, result.refreshToken);
    return result;
  }

  /**
   * Confirms an address. A POST, not the GET the emailed link points at: mail
   * scanners and link previewers fetch every URL they see, and a single-use
   * token behind a GET is spent before the recipient opens the message.
   */
  @Public()
  @StrictRateLimit()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(
    @Body(zodPipe(verifyEmailRequestSchema)) body: { token: string },
  ): Promise<void> {
    await this.verification.verify(body.token);
  }

  /** Always 204, whatever the address is. See EmailVerificationService.resend. */
  @Public()
  @StrictRateLimit()
  @Post('resend-verification')
  @HttpCode(204)
  async resendVerification(
    @Body(zodPipe(resendVerificationRequestSchema)) body: { email: string },
  ): Promise<void> {
    await this.verification.resend(body.email);
  }

  @Public()
  @StrictRateLimit()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodPipe(loginRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionDto> {
    const session = await this.auth.login(
      body as Parameters<AuthService['login']>[0],
      sessionContext(request),
    );
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

    const session = await this.auth.refresh(presented, sessionContext(request)).catch((error: unknown) => {
      // A refused token is a dead one; leaving it in the browser would make
      // every subsequent page load retry a credential that cannot work.
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
    // The cookie goes whatever happens: a logout that leaves the credential in
    // the browser is not a logout.
    clearRefreshCookie(reply, this.config);
    if (presented !== null) await this.auth.logout(presented, sessionContext(request));
  }

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
    await this.passwordReset.request(body.email, request.ip ?? null);
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
    await this.passwordReset.complete(body.token, body.newPassword);
    // Every session died with the password, including whatever this browser had.
    clearRefreshCookie(reply, this.config);
  }

  @Get('me')
  async me(@CurrentPrincipal() principal: Principal): Promise<UserDto> {
    return this.auth.getUser(assertUser(principal).userId);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(changePasswordRequestSchema))
    body: { currentPassword: string; newPassword: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.changePassword(assertUser(principal).userId, body);
    clearRefreshCookie(reply, this.config);
  }
}

function sessionContext(request: FastifyRequest): SessionContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

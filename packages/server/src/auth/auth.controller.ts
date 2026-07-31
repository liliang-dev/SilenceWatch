import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  verifyEmailRequestSchema,
  type RegisterResponse,
  type SessionDto,
  type SignupChallengeDto,
  type UserDto,
} from '@silencewatch/shared';
import type { FastifyRequest } from 'fastify';
import { StrictRateLimit } from '../common/rate-limit.guard';
import { zodPipe } from '../common/zod-validation.pipe';
import { Public } from './auth.guard';
import { AuthService, type SessionContext } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { assertUser, CurrentPrincipal, type Principal } from './principal';
import { SignupChallengeService } from './signup-challenge.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: EmailVerificationService,
    private readonly challenge: SignupChallengeService,
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
  ): Promise<RegisterResponse> {
    return this.auth.register(
      body as Parameters<AuthService['register']>[0],
      sessionContext(request),
    );
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
  ): Promise<SessionDto> {
    return this.auth.login(body as Parameters<AuthService['login']>[0], sessionContext(request));
  }

  /**
   * Public because the access token is, by definition, expired when this is
   * called; the refresh token is the credential.
   */
  @Public()
  @StrictRateLimit()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(zodPipe(refreshRequestSchema)) body: { refreshToken: string },
    @Req() request: FastifyRequest,
  ): Promise<SessionDto> {
    return this.auth.refresh(body.refreshToken, sessionContext(request));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(zodPipe(refreshRequestSchema)) body: { refreshToken: string }): Promise<void> {
    await this.auth.logout(body.refreshToken);
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
  ): Promise<void> {
    await this.auth.changePassword(assertUser(principal).userId, body);
  }
}

function sessionContext(request: FastifyRequest): SessionContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

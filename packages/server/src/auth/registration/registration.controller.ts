import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  registerRequestSchema,
  resendVerificationRequestSchema,
  verifyEmailRequestSchema,
  type RegisterRequest,
  type RegisterResponse,
  type SignupChallengeDto,
} from '@silencewatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../access/auth.guard';
import { StrictRateLimit } from '../../common/rate-limit.guard';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AppConfig, CONFIG } from '../../config/config';
import { sessionContextOf } from '../session-context';
import { setRefreshCookie } from '../sessions/refresh-cookie';
import { EmailVerificationService } from './email-verification/email-verification.service';
import { RegistrationService } from './registration.service';
import { SignupChallengeService } from './signup-challenge.service';

/** Creating an account and confirming its address. */
@Controller('auth')
export class RegistrationController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly registration: RegistrationService,
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
    @Body(zodPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RegisterResponse> {
    const result = await this.registration.register(body, sessionContextOf(request));
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
}

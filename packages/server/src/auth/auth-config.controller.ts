import { Controller, Get, Inject } from '@nestjs/common';
import type { AuthConfigDto } from '@silencewatch/shared';
import { Public } from '../access/auth.guard';
import { AppConfig, CONFIG } from '../config/config';
import { enabledProviders } from './better-auth/providers';
import { UsersRepository } from './users/users.repository';

/** What the sign-in page needs to know about this instance before anyone has signed in. */
@Controller('auth')
export class AuthConfigController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
  ) {}

  @Public()
  @Get('config')
  async describe(): Promise<AuthConfigDto> {
    const mode = this.config.AUTH_MODE;
    // Sign-up is closed to the public while the operator has named the first
    // account (it needs its setup link) or has closed it altogether.
    const signup =
      this.config.SIGNUP_ENABLED &&
      !(this.config.ADMIN_EMAIL !== undefined && (await this.users.isEmpty()));

    return {
      mode,
      passkey: mode !== 'password',
      password: mode === 'password',
      providers: enabledProviders(this.config),
      recoveryCodes: mode === 'passkey',
      signup,
    };
  }
}

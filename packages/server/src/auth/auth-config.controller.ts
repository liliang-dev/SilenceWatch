import { Controller, Get, Inject } from '@nestjs/common';
import type { AuthConfigDto } from '@silencewatch/shared';
import { Public } from '../access/auth.guard';
import { AppConfig, CONFIG } from '../config/config';
import { enabledProviders } from './better-auth/providers';

/** What the sign-in page needs to know about this instance before anyone has signed in. */
@Controller('auth')
export class AuthConfigController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Get('config')
  describe(): AuthConfigDto {
    const mode = this.config.AUTH_MODE;
    // Whether the public may create an account. The administrator's own comes
    // through its setup link, which opens the sign-up form whatever this says.
    const signup = this.config.SIGNUP_ENABLED;

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

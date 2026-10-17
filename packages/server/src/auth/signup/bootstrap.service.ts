import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfig, CONFIG } from '../../config/config';
import { UsersRepository } from '../users/users.repository';
import { SetupLinkService } from './setup-link.service';

/**
 * Says how to create the first account, when there is none and nobody could.
 *
 * With ADMIN_EMAIL set, the link is printed on every start until the account
 * exists; each one replaces nothing and expires on its own, so an old line in a
 * log is worth nothing. With sign-up closed and no address named, the log says
 * what to run instead.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly links: SetupLinkService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!(await this.users.isEmpty())) return;

    if (this.config.ADMIN_EMAIL !== undefined) {
      const { url, expiresAt } = await this.links.issue(this.config.ADMIN_EMAIL);
      this.logger.warn(
        `No account yet. Create the first one for ${this.config.ADMIN_EMAIL} with this link, ` +
          `once, before ${expiresAt.toISOString()}:\n  ${url}`,
      );
    } else if (!this.config.SIGNUP_ENABLED) {
      this.logger.warn(
        'No account yet, and sign-up is closed. Create the first one with: ' +
          'node dist/auth/cli.js create-admin --email <address>',
      );
    }
  }
}

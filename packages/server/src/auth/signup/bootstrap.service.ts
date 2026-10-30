import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfig, CONFIG } from '../../config/config';
import { UsersRepository } from '../users/users.repository';
import { SetupLinkService } from './setup-link.service';

/**
 * Prints the link that creates the administrator's account, on every start until
 * that account exists. Each link replaces nothing and expires on its own, so an old
 * line in a log is worth nothing.
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
    if ((await this.users.findByEmail(this.config.ADMIN_EMAIL)) !== null) return;

    const { email, url, expiresAt } = await this.links.issue();
    this.logger.warn(
      `No administrator account yet. Create it for ${email} with this link, ` +
        `once, before ${expiresAt.toISOString()}:\n  ${url}`,
    );
  }
}

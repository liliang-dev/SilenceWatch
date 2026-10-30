import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { assertUser, type Principal } from '../access/principal';
import { UsersRepository } from '../auth/users/users.repository';
import { AppConfig, CONFIG } from '../config/config';

/**
 * The one question every administrator route asks first: is this the account
 * ADMIN_EMAIL names?
 *
 * An API key is refused outright (401): it belongs to a project, and the figures
 * are about every project. Any other account gets 404, the answer it would get
 * from a route that does not exist, so the routes cannot even be told to be there.
 */
@Injectable()
export class AdministratorService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
  ) {}

  isAdministrator(userId: string): Promise<boolean> {
    return this.users.isAdministrator(userId, this.config.ADMIN_EMAIL);
  }

  async assert(principal: Principal): Promise<void> {
    const { userId } = assertUser(principal);
    if (!(await this.isAdministrator(userId))) throw new NotFoundException();
  }
}

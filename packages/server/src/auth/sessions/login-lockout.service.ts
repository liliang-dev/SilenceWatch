import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../users/users.repository';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60_000;

/**
 * The lockout that follows repeated wrong passwords, for a sign-in and for any
 * other place that asks for the password again.
 *
 * Temporary, not permanent: a locked-out account is a denial of service against
 * its owner if it never unlocks on its own.
 */
@Injectable()
export class LoginLockoutService {
  constructor(private readonly users: UsersRepository) {}

  isLocked(user: { lockedUntil: Date | null }): boolean {
    return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
  }

  async recordFailure(user: { id: string; failedLoginCount: number }): Promise<number> {
    const failures = user.failedLoginCount + 1;
    await this.users.recordFailedLogin(
      user.id,
      failures,
      failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
    );
    return failures;
  }
}

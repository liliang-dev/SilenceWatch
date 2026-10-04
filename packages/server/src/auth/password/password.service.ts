import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { ChangePasswordRequest } from '@silencewatch/shared';
import { AuditService } from '../../audit/audit.service';
import { hashPassword, verifyPassword } from '../../common/crypto.util';
import { maskEmail } from '../masking';
import { UsersRepository } from '../users/users.repository';

/** Changing the password of a signed-in user. The forgotten-password flow is PasswordResetService. */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async change(userId: string, input: ChangePasswordRequest): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      // 403, not 401: the caller is signed in, and 401 is what tells the browser
      // its session has expired, so it refreshes and sends the same wrong
      // password a second time before signing the user out.
      throw new ForbiddenException('Current password is incorrect');
    }

    // A password change ends every session: that is the point of changing it.
    // The lockout goes with the old password, exactly as it does on a reset.
    // Someone who has just proved the current password and chosen a new one
    // should not be kept out for fifteen minutes by failures that were somebody
    // else guessing at the password they just retired.
    await this.users.replacePasswordAndEndSessions(userId, await hashPassword(input.newPassword));

    this.logger.log(`Password changed for ${maskEmail(user.email)}`);
    this.audit.record({ action: 'auth.password_changed', actor: { userId, email: user.email } });
  }
}

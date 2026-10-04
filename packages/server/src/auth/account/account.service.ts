import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { DeleteAccountRequest, UserDto } from '@silencewatch/shared';
import { AuditService } from '../../audit/audit.service';
import { verifyPassword } from '../../common/crypto.util';
import { maskEmail } from '../masking';
import { auditActorOf, type SessionContext } from '../session-context';
import { LoginLockoutService } from '../sessions/login-lockout.service';
import { toUserDto } from '../users/user.mapper';
import { UsersRepository } from '../users/users.repository';

/** The signed-in user's own account: reading it, and deleting it. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly lockout: LoginLockoutService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (user === null) throw new UnauthorizedException('Account no longer exists');
    return toUserDto(user);
  }

  /**
   * Deletes the account and everything only it held, at once and for good.
   *
   * What goes: the user, its sessions and tokens, every project it is the sole
   * member of, and with those their checks, ping and incident history, API keys
   * and channels (the schema cascades). What stays: a project other people also
   * belong to, which merely loses this member, and the audit trail, which keeps
   * the address of whoever acted on purpose (see AuditService).
   *
   * A project that has other members but no other owner is refused rather than
   * orphaned: there is no way to hand ownership over yet, and leaving people in
   * a project nobody owns is worse than asking this user to sort it out first.
   *
   * The password is asked again even though the caller is signed in: an
   * unattended browser or a stolen access token must not be enough to destroy an
   * account. It counts against the lockout like a login does, for the same
   * reason: it is a password guess against the same account.
   */
  async delete(userId: string, input: DeleteAccountRequest, context: SessionContext): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);

    // 403 for both refusals: the caller is signed in, and a 401 would make the
    // browser retry the same wrong password (see PasswordService.change).
    if (this.lockout.isLocked(user)) {
      throw new ForbiddenException(
        'Too many failed attempts. Try again in a few minutes or reset your password.',
      );
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.lockout.recordFailure(user);
      throw new ForbiddenException('Current password is incorrect');
    }

    const soleProjects = await this.projectsToDelete(userId);
    await this.users.deleteWithProjects(userId, soleProjects);

    this.logger.log(
      `Account deleted for ${maskEmail(user.email)} (${soleProjects.length} project(s))`,
    );
    this.audit.record({
      action: 'account.deleted',
      actor: auditActorOf(user, context),
      targetType: 'user',
      targetId: userId,
      detail: { projectsDeleted: soleProjects.length },
    });
  }

  /** The projects only this user belongs to; refuses if one would be left without an owner. */
  private async projectsToDelete(userId: string): Promise<string[]> {
    const sole: string[] = [];
    for (const membership of await this.users.listMembershipsWithPeers(userId)) {
      if (membership.peers.length === 0) {
        sole.push(membership.projectId);
      } else if (
        membership.role === 'owner' &&
        !membership.peers.some((member) => member.role === 'owner')
      ) {
        throw new ConflictException(
          `You are the only owner of "${membership.projectName}", which has other members, ` +
            'so deleting your account would leave it without one.',
        );
      }
    }
    return sole;
  }
}

import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { UserDto } from '@silencewatch/shared';
import { AuditService } from '../../audit/audit.service';
import { BillingService } from '../../billing/billing.service';
import type { RequestOrigin } from '../better-auth/auth-policy';
import { maskEmail } from '../masking';
import { toUserDto } from '../users/user.mapper';
import { UsersRepository } from '../users/users.repository';

/** The signed-in user's own account: reading it, and deleting it. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async get(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (user === null) throw new UnauthorizedException('Account no longer exists');
    return toUserDto(user);
  }

  /**
   * Deletes the account and everything only it held, at once and for good.
   *
   * What goes: the user, its sessions and credentials, every project it is the
   * sole member of, and with those their checks, ping and incident history, API
   * keys and channels (the schema cascades). What stays: a project other people
   * also belong to, which merely loses this member, and the audit trail, which
   * keeps the address of whoever acted on purpose (see AuditService).
   *
   * A project that has other members but no other owner is refused rather than
   * orphaned: there is no way to hand ownership over yet, and leaving people in
   * a project nobody owns is worse than asking this user to sort it out first.
   *
   * The caller has been checked to have signed in a moment ago (see
   * assertRecentUser): an unattended browser must not be enough to destroy an
   * account.
   *
   * A subscription is ended first, and if it cannot be the account stays: see
   * BillingService.cancelForAccount.
   */
  async delete(userId: string, origin: RequestOrigin): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);

    // Before anything is deleted: an account that is gone while its card is
    // still charged is worse than an account that could not be deleted yet.
    await this.billing.cancelForAccount(userId);

    const soleProjects = await this.projectsToDelete(userId);
    await this.users.deleteWithProjects(userId, soleProjects);

    this.logger.log(
      `Account deleted for ${maskEmail(user.email)} (${soleProjects.length} project(s))`,
    );
    this.audit.record({
      action: 'account.deleted',
      actor: { userId: user.id, email: user.email, ...origin },
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

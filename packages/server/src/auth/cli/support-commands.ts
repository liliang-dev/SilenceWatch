import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import type { AppConfig } from '../../config/config';
import type { PrismaService } from '../../database/prisma.service';
import { RecoveryCodesService } from '../recovery/recovery-codes.service';
import { SetupLinkService } from '../signup/setup-link.service';
import { UsersRepository } from '../users/users.repository';

/** Raised for a request that cannot be carried out: the message is what the operator reads. */
export class SupportError extends Error {}

/** What the audit trail says about every change made from here. */
const OPERATOR = { email: 'operator (command line)' };

/**
 * The account tasks of whoever runs the server, one method per command.
 *
 * Each returns the text to print and nothing else, so the command line is only
 * argument parsing and the behaviour can be tested without a process. Every
 * change is written to the audit trail before the text is returned.
 */
export class SupportCommands {
  private readonly users: UsersRepository;
  private readonly audit: AuditService;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.users = new UsersRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  async createAdmin(email: string): Promise<string> {
    const { url, expiresAt } = await new SetupLinkService(this.config, this.prisma).issue(email);
    return `Open this link once, before ${expiresAt.toISOString()}:\n\n  ${url}`;
  }

  async resetPassword(email: string): Promise<string> {
    this.requireMode('password', 'reset-password');
    const user = await this.existing(email);
    const password = randomBytes(18).toString('base64url');
    await this.users.replacePasswordAndEndSessions(user.id, await hashPassword(password));
    await this.record(user, 'reset-password');
    return `New password for ${email} (shown once, change it after signing in):\n\n  ${password}`;
  }

  async recoveryCodes(email: string): Promise<string> {
    this.requireMode('passkey', 'recovery-codes');
    const user = await this.existing(email);
    const codes = await new RecoveryCodesService(this.config, this.prisma).replaceAll(user.id);
    await this.record(user, 'recovery-codes');
    return `Recovery codes for ${email} (shown once; the previous ones no longer work):\n\n  ${codes.join('\n  ')}`;
  }

  /** Read only: everything support needs to know about an account, none of its secrets. */
  async show(email: string): Promise<string> {
    const user = await this.existing(email);
    const [passkeys, accounts, sessions, memberships, subscription] = await Promise.all([
      this.prisma.passkey.count({ where: { userId: user.id } }),
      this.prisma.account.findMany({ where: { userId: user.id }, select: { providerId: true } }),
      this.prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
      this.prisma.projectMember.findMany({
        where: { userId: user.id },
        select: { role: true, project: { select: { name: true, _count: { select: { checks: true } } } } },
      }),
      this.prisma.subscription.findUnique({ where: { userId: user.id } }),
    ]);

    const methods = [
      ...(passkeys > 0 ? [`passkey ×${passkeys}`] : []),
      ...accounts.map((account) => (account.providerId === 'credential' ? 'password' : account.providerId)),
    ];
    const locked = user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
    const lines: Array<[string, string]> = [
      ['Account', `${user.email} (${user.id})`],
      ['Created', user.createdAt.toISOString()],
      ['Last sign-in', user.lastLoginAt?.toISOString() ?? 'never'],
      ['Email verified', user.emailVerified ? 'yes' : 'no'],
      ['Plan', user.plan ?? 'none (unlimited)'],
      [
        'Subscription',
        subscription === null
          ? 'none'
          : `${subscription.status}, grants ${subscription.plan ?? 'no plan'}` +
            (subscription.cancelAtPeriodEnd ? ', ends at period end' : ''),
      ],
      ['Sign-in methods', methods.length > 0 ? methods.join(', ') : 'none'],
      ['Live sessions', String(sessions)],
      [
        'Lockout',
        locked ? `locked until ${user.lockedUntil?.toISOString()}` : `none (${user.failedLoginCount} recent failures)`,
      ],
      [
        'Projects',
        memberships.length === 0
          ? 'none'
          : memberships
              .map((m) => `${m.project.name} (${m.role}, ${m.project._count.checks} checks)`)
              .join('; '),
      ],
    ];
    return lines.map(([label, value]) => `${label.padEnd(16)}${value}`).join('\n');
  }

  /** For an address nobody can prove by mail: the operator vouches for it, and Google can then be linked. */
  async verifyEmail(email: string): Promise<string> {
    const user = await this.existing(email);
    if (user.emailVerified) return `${email} was already verified. Nothing changed.`;
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    await this.record(user, 'verify-email');
    return `${email} is now marked as verified.`;
  }

  async setPlan(email: string, plan: string): Promise<string> {
    const user = await this.existing(email);
    const next = plan === 'none' ? null : plan;
    if (next !== null && this.config.planLimits[next] === undefined) {
      const known = Object.keys(this.config.planLimits);
      throw new SupportError(
        `Unknown plan "${plan}". PLAN_LIMITS defines: ${known.length > 0 ? known.join(', ') : '(nothing)'}. ` +
          'Use "none" for no limits.',
      );
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { plan: next } });
    await this.record(user, 'set-plan', { from: user.plan, to: next });

    const subscription = await this.prisma.subscription.findUnique({ where: { userId: user.id } });
    const warning =
      subscription !== null && subscription.status !== 'none'
        ? '\nNote: this account has a Stripe subscription, and its next event sets the plan again.'
        : '';
    return `Plan of ${email}: ${user.plan ?? 'none'} → ${next ?? 'none'}.${warning}`;
  }

  /** Ends a lockout early: the person typed a wrong password too many times, and asked for help. */
  async unlock(email: string): Promise<string> {
    const user = await this.existing(email);
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await this.record(user, 'unlock');
    return `${email} can sign in again.`;
  }

  /** Signs the account out everywhere: for a lost device, or an account somebody else may have reached. */
  async endSessions(email: string): Promise<string> {
    const user = await this.existing(email);
    const { count } = await this.prisma.session.deleteMany({ where: { userId: user.id } });
    await this.record(user, 'end-sessions', { sessions: count });
    return `Ended ${count} session(s) of ${email}.`;
  }

  private async existing(email: string) {
    const user = await this.users.findByEmail(email);
    if (user === null) throw new SupportError(`No account for ${email}.`);
    return user;
  }

  private requireMode(mode: AppConfig['AUTH_MODE'], command: string): void {
    if (this.config.AUTH_MODE !== mode) {
      throw new SupportError(
        `${command} only applies when AUTH_MODE=${mode} (this instance runs ${this.config.AUTH_MODE}).`,
      );
    }
  }

  private record(
    user: { id: string; email: string },
    command: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    return this.audit.recordNow({
      action: 'operator.change',
      actor: OPERATOR,
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      detail: { command, ...detail },
    });
  }
}

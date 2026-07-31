import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG, type PlanLimits } from '../config/config';
import { PrismaService } from '../database/prisma.service';

/** Unlimited on every axis — what a self-hosted install always gets. */
const UNLIMITED: PlanLimits = {};

export type QuotaResource = 'checks' | 'projects' | 'channels';

/**
 * Plan limits, and where they bite.
 *
 * The rule this file exists to keep: **quotas are off unless someone turned
 * them on**. `QUOTAS_ENABLED` unset, or an account with no plan, means
 * unlimited on every axis. A self-hosted SilenceWatch must never discover that
 * it is the reduced edition of something.
 *
 * Limits attach to the **owner of a project**, not to whoever is acting. A
 * member invited into someone else's project spends that owner's allowance, not
 * their own — otherwise inviting a colleague on a smaller plan would silently
 * shrink your own ceiling.
 */
@Injectable()
export class QuotaService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return this.config.QUOTAS_ENABLED;
  }

  /** The plan a new account is put on. Null when quotas are off. */
  get defaultPlan(): string | null {
    return this.enabled ? this.config.DEFAULT_PLAN : null;
  }

  /**
   * Limits for a plan name.
   *
   * An unknown name resolves to unlimited rather than to the smallest plan.
   * That is deliberate: the failure mode of a typo in configuration, or of a
   * plan renamed on the billing side, should be a customer who briefly gets too
   * much — not a paying customer locked out of their own monitoring.
   */
  limitsFor(plan: string | null): PlanLimits {
    if (!this.enabled || plan === null) return UNLIMITED;
    return this.config.planLimits[plan] ?? UNLIMITED;
  }

  /** Limits of the account that owns a project. */
  async limitsForProject(projectId: string): Promise<PlanLimits> {
    if (!this.enabled) return UNLIMITED;
    const owner = await this.ownerOf(projectId);
    return this.limitsFor(owner?.plan ?? null);
  }

  /**
   * Refuses the creation of a check when the owner's account is at its ceiling.
   *
   * Counted across every project the account owns, because that is what "your
   * plan includes N checks" means to the person paying for it.
   */
  async assertCanAddCheck(projectId: string, adding = 1): Promise<void> {
    if (!this.enabled) return;

    const owner = await this.ownerOf(projectId);
    if (owner === null) return;

    const limit = this.limitsFor(owner.plan).checks;
    if (limit === undefined) return;

    const used = await this.countOwnedChecks(owner.id);
    if (used + adding > limit) {
      throw new QuotaExceededError('checks', used, limit, owner.plan);
    }
  }

  /**
   * How many more checks fit. Used by the starter sync, which must not fail an
   * entire deployment because one job pushed the account over.
   */
  async remainingChecks(projectId: string): Promise<number | null> {
    if (!this.enabled) return null;

    const owner = await this.ownerOf(projectId);
    if (owner === null) return null;

    const limit = this.limitsFor(owner.plan).checks;
    if (limit === undefined) return null;

    return Math.max(0, limit - (await this.countOwnedChecks(owner.id)));
  }

  async assertCanAddProject(userId: string): Promise<void> {
    if (!this.enabled) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    const limit = this.limitsFor(user?.plan ?? null).projects;
    if (limit === undefined) return;

    const used = await this.prisma.projectMember.count({
      where: { userId, role: 'owner' },
    });
    if (used + 1 > limit) {
      throw new QuotaExceededError('projects', used, limit, user?.plan ?? null);
    }
  }

  async assertCanAddChannel(projectId: string): Promise<void> {
    if (!this.enabled) return;

    const limit = (await this.limitsForProject(projectId)).channelsPerProject;
    if (limit === undefined) return;

    const used = await this.prisma.notificationChannel.count({ where: { projectId } });
    if (used + 1 > limit) {
      const owner = await this.ownerOf(projectId);
      throw new QuotaExceededError('channels', used, limit, owner?.plan ?? null);
    }
  }

  /**
   * Retention for a project: the plan's ceiling wins over a larger project
   * setting. Capped rather than refused — a project asking to keep a year of
   * history on a plan that allows a week should keep a week, not error.
   */
  async retentionDaysFor(projectId: string, requested: number): Promise<number> {
    const ceiling = (await this.limitsForProject(projectId)).retentionDays;
    return ceiling === undefined ? requested : Math.min(requested, ceiling);
  }

  /** Checks in every project this account owns. */
  async countOwnedChecks(userId: string): Promise<number> {
    return this.prisma.check.count({
      where: { project: { members: { some: { userId, role: 'owner' } } } },
    });
  }

  private async ownerOf(projectId: string): Promise<{ id: string; plan: string | null } | null> {
    const membership = await this.prisma.projectMember.findFirst({
      where: { projectId, role: 'owner' },
      select: { user: { select: { id: true, plan: true } } },
    });
    return membership?.user ?? null;
  }
}

/**
 * 402, not 403.
 *
 * "Forbidden" says you may never do this; a quota says you may, on a bigger
 * plan. The client needs to tell those apart to know whether to show an upgrade
 * link or an apology, and the payload carries the numbers so it can say
 * *which* limit without a second request.
 */
export class QuotaExceededError extends HttpException {
  constructor(resource: QuotaResource, used: number, limit: number, plan: string | null) {
    super(
      {
        message:
          resource === 'channels'
            ? `This project already has the ${limit} alert channels its plan allows.`
            : `Your plan includes ${limit} ${resource}, and ${used} are in use.`,
        details: { quota: { resource, used, limit, plan } },
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

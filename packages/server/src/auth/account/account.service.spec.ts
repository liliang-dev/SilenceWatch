import { ConflictException } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import type { BillingService } from '../../billing/billing.service';
import { hashPassword } from '../../common/crypto.util';
import type { LoginLockoutService } from '../sessions/login-lockout.service';
import type { MembershipWithPeers, UsersRepository } from '../users/users.repository';
import { AccountService } from './account.service';

describe('AccountService.delete', () => {
  const context = { ip: null, userAgent: null };
  let memberships: MembershipWithPeers[];
  const deleteWithProjects = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn();

  async function service(): Promise<AccountService> {
    const user = {
      id: 'me',
      email: 'me@example.test',
      passwordHash: await hashPassword('correct horse battery'),
      lockedUntil: null,
      failedLoginCount: 0,
    };
    return new AccountService(
      {
        findByIdOrThrow: async () => user,
        listMembershipsWithPeers: async () => memberships,
        deleteWithProjects,
      } as unknown as UsersRepository,
      { isLocked: () => false, recordFailure: jest.fn() } as unknown as LoginLockoutService,
      { record } as unknown as AuditService,
      { cancelForAccount: jest.fn() } as unknown as BillingService,
    );
  }

  beforeEach(() => {
    deleteWithProjects.mockClear();
    record.mockClear();
  });

  it('deletes the projects only this user belongs to, and keeps shared ones', async () => {
    memberships = [
      { projectId: 'alone', role: 'owner', projectName: 'Alone', peers: [] },
      { projectId: 'shared', role: 'member', projectName: 'Shared', peers: [{ userId: 'x', role: 'owner' }] },
    ];

    await (await service()).delete('me', { password: 'correct horse battery' }, context);

    expect(deleteWithProjects).toHaveBeenCalledWith('me', ['alone']);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.deleted' }));
  });

  it('refuses to leave a shared project without an owner', async () => {
    memberships = [
      { projectId: 'team', role: 'owner', projectName: 'Team', peers: [{ userId: 'x', role: 'member' }] },
    ];

    await expect(
      (await service()).delete('me', { password: 'correct horse battery' }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleteWithProjects).not.toHaveBeenCalled();
  });
});

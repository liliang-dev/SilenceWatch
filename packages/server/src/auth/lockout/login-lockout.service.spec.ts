import type { UsersRepository } from '../users/users.repository';
import { LoginLockoutService } from './login-lockout.service';

describe('LoginLockoutService', () => {
  const recordFailedLogin = jest.fn().mockResolvedValue(undefined);
  const lockout = new LoginLockoutService({ recordFailedLogin } as unknown as UsersRepository);

  beforeEach(() => recordFailedLogin.mockClear());

  it('counts a failure without locking until the tenth', async () => {
    expect(await lockout.recordFailure({ id: 'u', failedLoginCount: 8 })).toBe(9);
    expect(recordFailedLogin).toHaveBeenCalledWith('u', 9, null);
  });

  it('locks for a while on the tenth consecutive failure', async () => {
    await lockout.recordFailure({ id: 'u', failedLoginCount: 9 });

    const [, failures, lockedUntil] = recordFailedLogin.mock.calls[0] as [string, number, Date];
    expect(failures).toBe(10);
    expect(lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('is locked only while the deadline is in the future', () => {
    expect(lockout.isLocked({ lockedUntil: null })).toBe(false);
    expect(lockout.isLocked({ lockedUntil: new Date(Date.now() - 1_000) })).toBe(false);
    expect(lockout.isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });
});

import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const guard = new AdminGuard();
  const contextFor = (systemRole: 'ADMIN' | 'USER', status: 'ACTIVE' | 'LOCKED') => ({
    switchToHttp: () => ({ getRequest: () => ({ user: { systemRole, status } }) }),
  }) as unknown as ExecutionContext;

  it('allows an active admin', () => expect(guard.canActivate(contextFor('ADMIN', 'ACTIVE'))).toBe(true));
  it('rejects users and locked admins', () => {
    expect(() => guard.canActivate(contextFor('USER', 'ACTIVE'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor('ADMIN', 'LOCKED'))).toThrow(ForbiddenException);
  });
});

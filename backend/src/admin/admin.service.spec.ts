import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import type { RepositoryLockService } from '../repositories/repository-lock.service';
import { AdminService } from './admin.service';

describe('AdminService account locking', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  function makeService(target: Record<string, unknown>, activeAdmins: { id: string }[]) {
    const rawQuery = jest.fn().mockResolvedValue(activeAdmins);
    const findUser = jest.fn().mockResolvedValue(target);
    const updateUser = jest.fn().mockResolvedValue({ id: userId, username: 'member', status: 'LOCKED', systemRole: 'USER', lockedAt: new Date() });
    const revokedAt: Date[] = [];
    const revokeSessions = jest.fn((args: { data: { revokedAt: Date } }) => {
      revokedAt.push(args.data.revokedAt);
      return Promise.resolve({ count: 2 });
    });
    const createAudit = jest.fn().mockResolvedValue({});
    const tx = { $queryRaw: rawQuery, user: { findUnique: findUser, update: updateUser },
      session: { updateMany: revokeSessions }, auditLog: { create: createAudit } };
    const transaction = jest.fn((callback: (client: unknown) => unknown) => Promise.resolve(callback(tx)));
    const db = { $transaction: transaction };
    const locks = { acquire: jest.fn() };
    return { service: new AdminService(db as unknown as PrismaService, locks as unknown as RepositoryLockService), transaction, updateUser, revokeSessions, createAudit, revokedAt };
  }

  it('refuses to lock the final active administrator', async () => {
    const fixture = makeService({ id: userId, status: 'ACTIVE', systemRole: 'ADMIN' }, [{ id: userId }]);
    await expect(fixture.service.setUserStatus(actorId, userId, 'LOCKED')).rejects.toThrow(ConflictException);
    expect(fixture.updateUser).not.toHaveBeenCalled();
    expect(fixture.revokeSessions).not.toHaveBeenCalled();
  });

  it('revokes sessions and audits the same transaction when locking a user', async () => {
    const fixture = makeService({ id: userId, status: 'ACTIVE', systemRole: 'USER' }, [{ id: actorId }]);
    const result = await fixture.service.setUserStatus(actorId, userId, 'LOCKED');
    expect(result.changed).toBe(true);
    expect(fixture.revokeSessions).toHaveBeenCalledWith({ where: { userId, revokedAt: null }, data: { revokedAt: fixture.revokedAt[0] } });
    expect(fixture.revokedAt[0]).toBeInstanceOf(Date);
    expect(fixture.createAudit).toHaveBeenCalledWith({ data: { actorId, action: 'ADMIN_USER_LOCKED', targetId: userId,
      details: { from: 'ACTIVE', to: 'LOCKED' } } });
  });

  it('refuses self-lock without opening a transaction', async () => {
    const fixture = makeService({ id: actorId, status: 'ACTIVE', systemRole: 'ADMIN' }, [{ id: actorId }]);
    await expect(fixture.service.setUserStatus(actorId, actorId, 'LOCKED')).rejects.toThrow(ConflictException);
    expect(fixture.transaction).not.toHaveBeenCalled();
  });
});

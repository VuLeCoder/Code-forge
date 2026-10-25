import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    return { service: new AdminService(db as unknown as PrismaService, locks as unknown as RepositoryLockService,
      { assertNoUnresolved: jest.fn().mockResolvedValue(undefined) } as never,
      { reconcileOperation: jest.fn().mockResolvedValue(undefined) } as never), transaction, updateUser, revokeSessions, createAudit, revokedAt };
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

describe('AdminService restore and audit privacy', () => {
  const repositoryId = '33333333-3333-4333-8333-333333333333';
  const actorId = '22222222-2222-4222-8222-222222222222';

  it('rejects an expired restore without updating or auditing and releases its repository lock', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const findRepository = jest.fn().mockResolvedValue({
      id: repositoryId,
      status: 'DELETED',
      purgeAfter: new Date(Date.now() - 1000),
    });
    const updateRepository = jest.fn();
    const createAudit = jest.fn();
    const tx = { repository: { findUnique: findRepository, update: updateRepository }, auditLog: { create: createAudit } };
    const db = { $transaction: jest.fn((callback: (client: unknown) => unknown) => Promise.resolve(callback(tx))) };
    const locks = { acquire: jest.fn().mockResolvedValue({ release }) };
    const service = new AdminService(db as unknown as PrismaService, locks as unknown as RepositoryLockService,
      { assertNoUnresolved: jest.fn().mockResolvedValue(undefined) } as never,
      { reconcileOperation: jest.fn().mockResolvedValue(undefined) } as never);

    await expect(service.restoreRepository(actorId, repositoryId)).rejects.toThrow(ConflictException);

    expect(locks.acquire).toHaveBeenCalledWith(repositoryId);
    expect(findRepository).toHaveBeenCalledWith({ where: { id: repositoryId } });
    expect(updateRepository).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns only allowlisted audit details and omits secret or source-like keys', async () => {
    const db = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'audit-1',
          actorId: null,
          action: 'REPOSITORY_UPDATED',
          targetId: repositoryId,
          details: {
            repositoryId,
            role: 'WRITE',
            token: 'cfg_sensitive',
            password: 'sensitive-password',
            diff: 'private source content',
          },
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminService(db as unknown as PrismaService, {} as RepositoryLockService, {} as never, {} as never);

    const result = await service.listAudit({});

    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]?.details).toEqual({ repositoryId, role: 'WRITE' });
    expect(JSON.stringify(result.audit)).not.toContain('cfg_sensitive');
    expect(JSON.stringify(result.audit)).not.toContain('sensitive-password');
    expect(JSON.stringify(result.audit)).not.toContain('private source content');
  });
});

describe('AdminService unresolved operations and resolution', () => {
  const repositoryId = '33333333-3333-4333-8333-333333333333';
  const operationId = '44444444-4444-4444-8444-444444444444';
  const actorId = '22222222-2222-4222-8222-222222222222';

  it('lists unresolved push and merge operations sorted by updatedAt desc', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 10_000);
    const db = {
      gitPushOperation: {
        findMany: jest.fn().mockResolvedValue([{
          operationId: 'push-1', repositoryId, actorId, status: 'NEEDS_RECONCILIATION', errorCode: 'STORAGE_UNAVAILABLE',
          storageGeneration: 1, changedRefCount: 2, createdAt: older, updatedAt: now,
          repository: { name: 'repo-1', owner: { username: 'alice' } },
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
      pullRequestMergeOperation: {
        findMany: jest.fn().mockResolvedValue([{
          operationId: 'merge-1', repositoryId, actorId, status: 'PENDING', errorCode: null,
          storageGeneration: 1, createdAt: older, updatedAt: older, pullRequestId: 'pr-1',
          pullRequest: { number: 42, targetBranch: 'main' },
          repository: { name: 'repo-1', owner: { username: 'alice' } },
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new AdminService(db as unknown as PrismaService, {} as RepositoryLockService, {} as never, {} as never);

    const result = await service.listUnresolvedOperations({});

    expect(result.operations).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.operations[0]?.operationId).toBe('push-1');
    expect(result.operations[0]?.type).toBe('PUSH');
    expect(result.operations[1]?.operationId).toBe('merge-1');
    expect(result.operations[1]?.type).toBe('MERGE');
  });

  it('resolves a push operation as MARK_FAILED, updates status, and audits atomically under lock', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const lock = { release };
    const locks = { acquire: jest.fn().mockResolvedValue(lock) };
    const pushOp = {
      operationId, repositoryId, status: 'NEEDS_RECONCILIATION', errorCode: 'STORAGE_UNAVAILABLE',
      repository: { id: repositoryId, storageGeneration: 1 },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const createAudit = jest.fn().mockResolvedValue({});
    const tx = { gitPushOperation: { updateMany }, auditLog: { create: createAudit } };
    const db = {
      gitPushOperation: { findUnique: jest.fn().mockResolvedValue(pushOp) },
      $transaction: jest.fn((cb: (client: unknown) => unknown) => Promise.resolve(cb(tx))),
    };
    const service = new AdminService(db as unknown as PrismaService, locks as unknown as RepositoryLockService, {} as never, {} as never);

    const result = await service.resolveOperation(actorId, operationId, {
      type: 'PUSH',
      action: 'MARK_FAILED',
      reason: 'ABANDONED_OFFLINE',
    });

    expect(locks.acquire).toHaveBeenCalledWith(repositoryId);
    expect(result).toEqual({ operationId, type: 'PUSH', status: 'FAILED', changed: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { operationId, status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'FAILED', errorCode: 'RESOLVED_BY_ADMIN_AS_FAILED', beforeRefs: Prisma.DbNull },
    });
    expect(createAudit).toHaveBeenCalledWith({
      data: {
        actorId,
        action: 'ADMIN_OPERATION_RESOLVED',
        targetId: operationId,
        details: {
          repositoryId, type: 'PUSH', action: 'MARK_FAILED', reason: 'ABANDONED_OFFLINE',
          from: 'NEEDS_RECONCILIATION', to: 'FAILED',
        },
      },
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('resolves a merge operation with RETRY_RECONCILE, invokes maintenance reconciler under lock', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const lock = { release };
    const locks = { acquire: jest.fn().mockResolvedValue(lock) };
    const mergeOp = {
      operationId, repositoryId, status: 'NEEDS_RECONCILIATION', errorCode: 'CROSS_TYPE_OPERATION_UNRESOLVED',
      pullRequestId: 'pr-1',
      repository: { id: repositoryId, storageGeneration: 1 },
      pullRequest: { id: 'pr-1', number: 10 },
    };
    const update = jest.fn().mockResolvedValue({ ...mergeOp, errorCode: null });
    const maintenanceJobs = { reconcileOperation: jest.fn().mockResolvedValue(undefined) };
    const createAudit = jest.fn().mockResolvedValue({});
    const tx = { auditLog: { create: createAudit } };
    const db = {
      pullRequestMergeOperation: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(mergeOp) // initial check
          .mockResolvedValueOnce(mergeOp) // under lock check
          .mockResolvedValueOnce({ ...mergeOp, status: 'COMPLETED', errorCode: null }), // post-reconcile check
        update,
      },
      $transaction: jest.fn((cb: (client: unknown) => unknown) => Promise.resolve(cb(tx))),
    };
    const service = new AdminService(db as unknown as PrismaService, locks as unknown as RepositoryLockService, {} as never, maintenanceJobs as never);

    const result = await service.resolveOperation(actorId, operationId, {
      type: 'MERGE',
      action: 'RETRY_RECONCILE',
      reason: 'RETRY_CROSS_TYPE',
    });

    expect(locks.acquire).toHaveBeenCalledWith(repositoryId);
    expect(update).toHaveBeenCalledWith({ where: { operationId }, data: { errorCode: null, status: 'NEEDS_RECONCILIATION' } });
    expect(maintenanceJobs.reconcileOperation).toHaveBeenCalledWith(operationId);
    expect(result).toEqual({ operationId, type: 'MERGE', status: 'COMPLETED', errorCode: null, changed: true });
    expect(release).toHaveBeenCalledTimes(1);
  });
});

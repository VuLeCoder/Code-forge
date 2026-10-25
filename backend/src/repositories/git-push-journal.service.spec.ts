import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { GitStorageService } from './git-storage.service';
import type { RepositoryLockService } from './repository-lock.service';
import { GitPushJournalService } from './git-push-journal.service';

describe('GitPushJournalService', () => {
  const operationId = '11111111-1111-4111-8111-111111111111';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const actorId = '33333333-3333-4333-8333-333333333333';
  const repository = { storageKey: 'repo.git', storageGeneration: 4 };

  function fixture(overrides: Record<string, unknown> = {}) {
    const operation = { operationId, repositoryId, actorId, storageGeneration: 4, status: 'PENDING',
      beforeRefs: { 'refs/heads/main': 'a'.repeat(40) }, createdAt: new Date(0), repository, ...overrides };
    const tx = {
      gitPushOperation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const db = {
      gitPushOperation: {
        count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue(operation),
        findUnique: jest.fn().mockResolvedValue(operation), findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    };
    const storage = { exists: jest.fn().mockResolvedValue(true), snapshotRefs: jest.fn().mockResolvedValue({}),
      validateRef: jest.fn() };
    const lock = { release: jest.fn().mockResolvedValue(undefined) };
    const locks = { acquire: jest.fn().mockResolvedValue(lock) };
    const service = new GitPushJournalService(db as unknown as PrismaService,
      storage as unknown as GitStorageService, locks as unknown as RepositoryLockService);
    return { service, db, tx, storage, lock, locks, operation };
  }

  it('blocks repository work while a push outcome is unresolved', async () => {
    const f = fixture();
    f.db.gitPushOperation.count.mockResolvedValueOnce(1);
    await expect(f.service.assertNoUnresolved(repositoryId)).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.gitPushOperation.count).toHaveBeenCalledWith({ where: { repositoryId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } } });
  });

  it('atomically records one audit for the exact number of changed refs without storing ref names or SHAs in audit', async () => {
    const f = fixture();
    const result = await f.service.finish(operationId, {
      'refs/heads/main': 'b'.repeat(40), 'refs/heads/feature/new': 'c'.repeat(40),
    });
    expect(result).toBe(true);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] }, storageGeneration: 4 },
      data: { status: 'COMPLETED', changedRefCount: 2, errorCode: null, beforeRefs: Prisma.DbNull } });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId, action: 'GIT_PUSH_COMPLETED', targetId: repositoryId,
      details: { operationId, repositoryId, storageGeneration: 4, changedRefCount: 2 } } });
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain('refs/heads');
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain('a'.repeat(40));
  });

  it('marks a no-ref-change operation failed without emitting a success audit', async () => {
    const f = fixture();
    await expect(f.service.finish(operationId, { 'refs/heads/main': 'a'.repeat(40) })).resolves.toBe(true);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'FAILED', errorCode: 'NO_REF_CHANGE', beforeRefs: Prisma.DbNull } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to attribute a changed ref snapshot across storage generations', async () => {
    const f = fixture({ repository: { ...repository, storageGeneration: 5 } });
    await expect(f.service.finish(operationId, { 'refs/heads/main': 'b'.repeat(40) })).resolves.toBe(false);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'STORAGE_GENERATION_CHANGED' } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('reconciles under the repository lock and completes exactly once', async () => {
    const f = fixture();
    f.db.gitPushOperation.findMany.mockResolvedValue([{ operationId, repositoryId }]);
    f.storage.snapshotRefs.mockResolvedValue({ 'refs/heads/main': 'b'.repeat(40) });
    await f.service.reconcilePending();
    f.db.gitPushOperation.findMany.mockResolvedValueOnce([]);
    await f.service.reconcilePending();
    expect(f.locks.acquire).toHaveBeenCalledWith(repositoryId);
    expect(f.lock.release).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

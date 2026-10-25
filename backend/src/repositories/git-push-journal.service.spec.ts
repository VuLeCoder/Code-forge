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
    const operation = { operationId, repositoryId, actorId, storageGeneration: 4, status: 'PENDING', errorCode: 'GIT_CHILD_SUCCEEDED',
      beforeRefs: { 'refs/heads/main': 'a'.repeat(40) }, createdAt: new Date(0), repository, ...overrides };
    const tx = {
      gitPushOperation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const db = {
      gitPushOperation: {
        count: jest.fn().mockResolvedValue(0), create: jest.fn<Promise<typeof operation>, [unknown]>().mockResolvedValue(operation),
        findUnique: jest.fn().mockResolvedValue(operation),
        findMany: jest.fn<Promise<{ operationId: string; repositoryId: string }[]>, [unknown]>().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pullRequestMergeOperation: { count: jest.fn().mockResolvedValue(0) },
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

  it('blocks normal repository writes for either unresolved journal type', async () => {
    const f = fixture();
    f.db.pullRequestMergeOperation.count.mockResolvedValueOnce(1);
    await expect(f.service.assertNoUnresolved(repositoryId)).rejects.toMatchObject({
      response: { error: { code: 'MERGE_RECONCILIATION_REQUIRED' } },
    });
    expect(f.db.gitPushOperation.count).toHaveBeenCalledTimes(1);
    expect(f.db.pullRequestMergeOperation.count).toHaveBeenCalledWith({ where: { repositoryId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } } });
  });

  it('offers a push-only fence for merge reconciliation', async () => {
    const f = fixture();
    await expect(f.service.assertNoUnresolvedPush(repositoryId)).resolves.toBeUndefined();
    expect(f.db.gitPushOperation.count).toHaveBeenCalledTimes(1);
    expect(f.db.pullRequestMergeOperation.count).not.toHaveBeenCalled();
  });

  it('persists unknown child outcome before Git can start', async () => {
    const f = fixture();
    const beforeRefs = { 'refs/heads/main': 'a'.repeat(40) };
    await f.service.begin(repositoryId, actorId, 4, beforeRefs);
    expect(f.db.gitPushOperation.create.mock.calls[0]?.[0]).toMatchObject({ data: {
      repositoryId, actorId, storageGeneration: 4, beforeRefs,
      errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN',
    } });
  });

  it('records child success only over an unresolved unknown outcome', async () => {
    const f = fixture({ errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN' });
    await expect(f.service.recordChildSuccess(operationId)).resolves.toBe(true);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: {
      operationId, status: 'PENDING', errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN',
    }, data: { errorCode: 'GIT_CHILD_SUCCEEDED' } });
    f.db.gitPushOperation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.recordChildSuccess(operationId)).resolves.toBe(false);
  });

  it('atomically records one audit for the exact number of changed refs without storing ref names or SHAs in audit', async () => {
    const f = fixture();
    const result = await f.service.finish(operationId, {
      'refs/heads/main': 'b'.repeat(40), 'refs/heads/feature/new': 'c'.repeat(40),
    });
    expect(result).toBe(true);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] }, storageGeneration: 4, errorCode: 'GIT_CHILD_SUCCEEDED' },
      data: { status: 'COMPLETED', changedRefCount: 2, errorCode: null, beforeRefs: Prisma.DbNull } });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId, action: 'GIT_PUSH_COMPLETED', targetId: repositoryId,
      details: { operationId, repositoryId, storageGeneration: 4, changedRefCount: 2 } } });
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain('refs/heads');
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain('a'.repeat(40));
  });

  it('does not emit an audit when the transactional completion loses its compare-and-swap', async () => {
    const f = fixture();
    f.tx.gitPushOperation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(f.service.finish(operationId, { 'refs/heads/main': 'b'.repeat(40) })).resolves.toBe(false);

    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('counts changed, added, and deleted branch refs without leaking refs or SHAs into the audit', async () => {
    const f = fixture({ beforeRefs: {
      'refs/heads/main': 'a'.repeat(40), 'refs/heads/deleted': 'd'.repeat(40),
    } });
    const result = await f.service.finish(operationId, {
      'refs/heads/main': 'b'.repeat(40), 'refs/heads/added': 'c'.repeat(40),
    });

    expect(result).toBe(true);
    expect(f.tx.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] }, storageGeneration: 4, errorCode: 'GIT_CHILD_SUCCEEDED' },
      data: { status: 'COMPLETED', changedRefCount: 3, errorCode: null, beforeRefs: Prisma.DbNull } });
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId, action: 'GIT_PUSH_COMPLETED', targetId: repositoryId,
      details: { operationId, repositoryId, storageGeneration: 4, changedRefCount: 3 } } });
    const audit = JSON.stringify(f.tx.auditLog.create.mock.calls);
    for (const ref of ['refs/heads/main', 'refs/heads/deleted', 'refs/heads/added']) expect(audit).not.toContain(ref);
    for (const sha of ['a', 'b', 'c', 'd']) expect(audit).not.toContain(sha.repeat(40));
  });

  it('marks a no-ref-change operation failed without emitting a success audit', async () => {
    const f = fixture();
    await expect(f.service.finish(operationId, { 'refs/heads/main': 'a'.repeat(40) })).resolves.toBe(true);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] }, errorCode: 'GIT_CHILD_SUCCEEDED' },
      data: { status: 'FAILED', errorCode: 'NO_REF_CHANGE', beforeRefs: Prisma.DbNull } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed ref snapshot without completing or auditing the push', async () => {
    const f = fixture({ beforeRefs: { 'refs/heads/main': 'not-a-sha' } });

    await expect(f.service.finish(operationId, { 'refs/heads/main': 'b'.repeat(40) }))
      .rejects.toThrow('Invalid Git ref snapshot');

    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to attribute a changed ref snapshot across storage generations', async () => {
    const f = fixture({ repository: { ...repository, storageGeneration: 5 } });
    await expect(f.service.finish(operationId, { 'refs/heads/main': 'b'.repeat(40) })).resolves.toBe(false);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'NEEDS_RECONCILIATION' } });
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

  it('keeps a durable child-success journal fail-closed when its storage generation is stale', async () => {
    const f = fixture({ status: 'NEEDS_RECONCILIATION', storageGeneration: 3,
      repository: { ...repository, storageGeneration: 4 } });
    f.db.gitPushOperation.findMany.mockResolvedValue([{ operationId, repositoryId }]);

    await f.service.reconcilePending();

    expect(f.locks.acquire).toHaveBeenCalledWith(repositoryId);
    expect(f.lock.release).toHaveBeenCalledTimes(1);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } }, data: { status: 'NEEDS_RECONCILIATION' } });
    expect(f.storage.snapshotRefs).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();

    f.db.gitPushOperation.count.mockResolvedValueOnce(1);
    await expect(f.service.assertNoUnresolvedPush(repositoryId)).rejects.toMatchObject({
      response: { error: { code: 'GIT_PUSH_RECONCILIATION_REQUIRED' } },
    });
  });

  it('does not reconcile a push while an unresolved merge could explain its ref delta', async () => {
    const f = fixture();
    f.db.gitPushOperation.findMany.mockResolvedValue([{ operationId, repositoryId }]);
    f.db.pullRequestMergeOperation.count.mockResolvedValueOnce(1);

    await f.service.reconcilePending();

    expect(f.locks.acquire).toHaveBeenCalledWith(repositoryId);
    expect(f.storage.snapshotRefs).not.toHaveBeenCalled();
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'NEEDS_RECONCILIATION' } });
    expect(f.lock.release).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['GIT_CHILD_FAILED', 'GIT_CHILD_OUTCOME_UNKNOWN', null, 'REF_SNAPSHOT_UNAVAILABLE'])(
    'keeps outcome without durable success proof fenced: %s', async (errorCode) => {
    const f = fixture({ status: 'NEEDS_RECONCILIATION', errorCode });
    f.db.gitPushOperation.findMany.mockResolvedValue([{ operationId, repositoryId }]);
    f.storage.snapshotRefs.mockResolvedValue({ 'refs/heads/main': 'b'.repeat(40) });

    await f.service.reconcilePending();

    expect(f.db.gitPushOperation.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { errorCode: 'GIT_CHILD_SUCCEEDED' } });
    expect(f.storage.snapshotRefs).not.toHaveBeenCalled();
    expect(f.db.gitPushOperation.updateMany).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.lock.release).toHaveBeenCalledTimes(1);
    f.db.gitPushOperation.count.mockResolvedValueOnce(1);
    await expect(f.service.assertNoUnresolvedPush(repositoryId)).rejects.toMatchObject({
      response: { error: { code: 'GIT_PUSH_RECONCILIATION_REQUIRED' } },
    });
  });

  it.each(['GIT_CHILD_FAILED', 'GIT_CHILD_OUTCOME_UNKNOWN', null, 'REF_SNAPSHOT_UNAVAILABLE'])(
    'refuses direct completion without durable success proof: %s', async (errorCode) => {
    const f = fixture({ status: 'NEEDS_RECONCILIATION', errorCode });
    await expect(f.service.finish(operationId, { 'refs/heads/main': 'b'.repeat(40) })).resolves.toBe(false);
    expect(f.db.gitPushOperation.updateMany).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['GIT_CHILD_FAILED', 'GIT_CHILD_OUTCOME_UNKNOWN', 'GIT_CHILD_SUCCEEDED', null])(
    'preserves child-outcome evidence when recording a retryable error: %s', async (errorCode) => {
    const f = fixture({ status: 'NEEDS_RECONCILIATION', errorCode });
    await f.service.markNeedsReconciliation(operationId);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } }, data: { status: 'NEEDS_RECONCILIATION' } });
  });

  it('keeps a success proof reconcilable after its audit transaction fails', async () => {
    const f = fixture();
    f.tx.auditLog.create.mockRejectedValueOnce(new Error('isolated audit failure'));
    const afterRefs = { 'refs/heads/main': 'b'.repeat(40) };
    await expect(f.service.finish(operationId, afterRefs)).rejects.toThrow('isolated audit failure');
    await f.service.markNeedsReconciliation(operationId);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } }, data: { status: 'NEEDS_RECONCILIATION' } });
    f.db.gitPushOperation.findMany.mockResolvedValueOnce([{ operationId, repositoryId }]);
    f.storage.snapshotRefs.mockResolvedValueOnce(afterRefs);
    await f.service.reconcilePending();
    expect(f.db.$transaction).toHaveBeenCalledTimes(2);
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(f.operation.errorCode).toBe('GIT_CHILD_SUCCEEDED');
  });

  it('records failed child outcome only over its initial unknown proof', async () => {
    const f = fixture({ errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN' });
    await f.service.markChildFailed(operationId);
    expect(f.db.gitPushOperation.updateMany).toHaveBeenCalledWith({ where: { operationId,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] }, errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN' },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'GIT_CHILD_FAILED' } });
  });
});

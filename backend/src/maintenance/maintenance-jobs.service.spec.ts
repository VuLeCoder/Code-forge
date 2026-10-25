import type { PrismaService } from '../database/prisma.service';
import type { GitStorageService } from '../repositories/git-storage.service';
import type { RepositoryLockService } from '../repositories/repository-lock.service';
import type { RepositoryPurgeService } from '../repositories/repository-purge.service';
import { ConflictException } from '@nestjs/common';
import { MaintenanceJobsService } from './maintenance-jobs.service';

type MergeOperation = {
  operationId: string;
  repositoryId: string;
  pullRequestId: string;
  actorId: string;
  oldTargetSha: string;
  expectedSourceSha: string;
  candidateSha: string | null;
  storageGeneration: number;
  status: string;
  repository: { storageKey: string; storageGeneration: number };
  pullRequest: { targetBranch: string; number: number; mergedById: string | null };
};

function makeFixture(operation?: Partial<MergeOperation>) {
  const current: MergeOperation = {
    operationId: 'operation-1', repositoryId: 'repository-1', pullRequestId: 'pull-1', actorId: 'owner-1',
    oldTargetSha: 'target-old', expectedSourceSha: 'source-sha', candidateSha: 'merge-sha',
    storageGeneration: 4, status: 'PENDING',
    repository: { storageKey: 'owner/repo.git', storageGeneration: 4 },
    pullRequest: { targetBranch: 'main', number: 1, mergedById: 'owner-1' },
    ...operation,
  };
  const tx = {
    pullRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    pullRequestMergeOperation: { update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    pullRequestMergeOperation: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    gitPushOperation: { count: jest.fn().mockResolvedValue(0) },
  };
  const lock = { release: jest.fn().mockResolvedValue(undefined) };
  const locks = { acquire: jest.fn().mockResolvedValue(lock) };
  const storage = {
    branchSha: jest.fn().mockResolvedValue('merge-sha'),
    isAncestor: jest.fn().mockResolvedValue(true),
    commit: jest.fn().mockResolvedValue({ parentShas: ['target-old', 'source-sha'] }),
    cleanupOrphanedTemporaryDirectories: jest.fn().mockResolvedValue(0),
  };
  const purge = { purgeDue: jest.fn().mockResolvedValue(undefined) };
  const pushJournal = {
    assertNoUnresolved: jest.fn().mockResolvedValue(undefined),
    assertNoUnresolvedPush: jest.fn().mockResolvedValue(undefined),
    reconcilePending: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MaintenanceJobsService(
    db as unknown as PrismaService,
    locks as unknown as RepositoryLockService,
    storage as unknown as GitStorageService,
    purge as unknown as RepositoryPurgeService,
    pushJournal as never,
  );
  const internals = service as unknown as {
    runScheduled: () => Promise<void>;
    reconcileMerges: () => Promise<void>;
    reconcileOperation: (operationId: string) => Promise<void>;
  };
  return { service, internals, db, tx, locks, lock, storage, purge, pushJournal, operation: current };
}

describe('MaintenanceJobsService', () => {
  it('runs a batch on startup and clears its scheduled timer on shutdown', async () => {
    jest.useFakeTimers();
    try {
      const fixture = makeFixture();
      const run = jest.spyOn(fixture.internals, 'runScheduled').mockResolvedValue(undefined);

      fixture.service.onModuleInit();
      expect(run).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(2);

      await fixture.service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('awaits the active batch when runOnce is called during reconciliation', async () => {
    const fixture = makeFixture();
    let finishFirstBatch!: (result: number) => void;
    const firstBatchGate = new Promise<number>((resolve) => { finishFirstBatch = resolve; });
    fixture.db.$executeRaw.mockImplementationOnce(() => firstBatchGate);

    const first = fixture.service.runOnce();
    await Promise.resolve();
    const overlapping = fixture.service.runOnce();
    expect(overlapping).toBe(first);
    expect(fixture.locks.acquire).toHaveBeenCalledTimes(1);

    finishFirstBatch(1);
    await overlapping;
    expect(fixture.db.$executeRaw).toHaveBeenCalledTimes(3);
    expect(fixture.purge.purgeDue).toHaveBeenCalledTimes(1);
  });

  it('drains an active batch before maintenance shutdown completes', async () => {
    const fixture = makeFixture();
    let finishBatch!: (result: number) => void;
    const batch = new Promise<number>((resolve) => { finishBatch = resolve; });
    fixture.db.$executeRaw.mockImplementationOnce(() => batch);

    const running = fixture.service.runOnce();
    await Promise.resolve();
    let stopped = false;
    const shutdown = fixture.service.onModuleDestroy().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishBatch(1);
    await Promise.all([running, shutdown]);
    expect(stopped).toBe(true);
    expect(fixture.lock.release).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh runOnce batch after the previous shared promise settles', async () => {
    const fixture = makeFixture();

    const first = fixture.service.runOnce();
    await first;
    const second = fixture.service.runOnce();
    await second;

    expect(second).not.toBe(first);
    expect(fixture.locks.acquire).toHaveBeenCalledTimes(2);
    expect(fixture.db.$executeRaw).toHaveBeenCalledTimes(6);
    expect(fixture.purge.purgeDue).toHaveBeenCalledTimes(2);
    expect(fixture.storage.cleanupOrphanedTemporaryDirectories).toHaveBeenCalledTimes(2);
    expect(fixture.lock.release).toHaveBeenCalledTimes(2);
  });

  it('skips an overlapping batch and releases the process-wide job lock once', async () => {
    const fixture = makeFixture();
    let releaseAcquire!: (lock: { release: jest.Mock }) => void;
    fixture.locks.acquire.mockImplementationOnce(() => new Promise((resolve) => { releaseAcquire = resolve; }) as never);

    const first = fixture.internals.runScheduled();
    await Promise.resolve();
    await fixture.internals.runScheduled();
    expect(fixture.locks.acquire).toHaveBeenCalledTimes(1);

    releaseAcquire(fixture.lock);
    await first;
    expect(fixture.db.$executeRaw).toHaveBeenCalledTimes(3);
    expect(fixture.purge.purgeDue).toHaveBeenCalledWith(50);
    expect(fixture.lock.release).toHaveBeenCalledTimes(1);
  });

  it('does not overlap scheduled batches and lets the next run proceed after releasing the job lock', async () => {
    const fixture = makeFixture();
    let signalBatchEntered!: () => void;
    let finishFirstBatch!: (result: number) => void;
    const batchEntered = new Promise<void>((resolve) => { signalBatchEntered = resolve; });
    const firstBatchGate = new Promise<number>((resolve) => { finishFirstBatch = resolve; });
    fixture.db.$executeRaw.mockImplementationOnce(() => {
      signalBatchEntered();
      return firstBatchGate;
    });

    const firstRun = fixture.internals.runScheduled();
    await batchEntered;

    // A simultaneous invocation must return without entering any batch job.
    await fixture.internals.runScheduled();
    expect(fixture.db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fixture.purge.purgeDue).not.toHaveBeenCalled();
    expect(fixture.locks.acquire).toHaveBeenCalledTimes(1);

    finishFirstBatch(1);
    await firstRun;
    expect(fixture.db.$executeRaw).toHaveBeenCalledTimes(3);
    expect(fixture.purge.purgeDue).toHaveBeenCalledTimes(1);
    expect(fixture.lock.release).toHaveBeenCalledTimes(1);

    // Once the in-process guard and advisory lock are released, a later run can execute.
    await fixture.internals.runScheduled();
    expect(fixture.locks.acquire).toHaveBeenCalledTimes(2);
    expect(fixture.db.$executeRaw).toHaveBeenCalledTimes(6);
    expect(fixture.purge.purgeDue).toHaveBeenCalledTimes(2);
    expect(fixture.lock.release).toHaveBeenCalledTimes(2);
  });

  it('does not touch Git when storage generation changed and records reconciliation state', async () => {
    const fixture = makeFixture({ repository: { storageKey: 'owner/repo.git', storageGeneration: 5 } });
    await fixture.internals.reconcileOperation(fixture.operation.operationId);

    expect(fixture.db.pullRequestMergeOperation.update).toHaveBeenCalledWith({ where: { operationId: 'operation-1' },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'STORAGE_GENERATION_CHANGED' } });
    expect(fixture.storage.branchSha).not.toHaveBeenCalled();
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it('marks an operation failed only when target ref is still at its recorded old SHA', async () => {
    const fixture = makeFixture();
    fixture.storage.branchSha.mockResolvedValue('target-old');
    await fixture.internals.reconcileOperation(fixture.operation.operationId);

    expect(fixture.db.pullRequestMergeOperation.update).toHaveBeenCalledWith({ where: { operationId: 'operation-1' },
      data: { status: 'FAILED', errorCode: 'REF_NOT_UPDATED' } });
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it('keeps unknown ref outcomes pending reconciliation instead of rolling Git back', async () => {
    const fixture = makeFixture();
    fixture.storage.isAncestor.mockResolvedValue(false);
    await fixture.internals.reconcileOperation(fixture.operation.operationId);

    expect(fixture.db.pullRequestMergeOperation.update).toHaveBeenCalledWith({ where: { operationId: 'operation-1' },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'REF_OUTCOME_UNKNOWN' } });
    expect(fixture.storage.commit).not.toHaveBeenCalled();
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it('does not repeat metadata or audit writes when reconciliation is invoked after completion', async () => {
    const fixture = makeFixture();
    fixture.db.pullRequestMergeOperation.findUnique
      .mockResolvedValueOnce(fixture.operation)
      .mockResolvedValueOnce({ ...fixture.operation, status: 'COMPLETED' });

    await fixture.internals.reconcileOperation(fixture.operation.operationId);
    await fixture.internals.reconcileOperation(fixture.operation.operationId);

    expect(fixture.db.$transaction).toHaveBeenCalledTimes(1);
    expect(fixture.tx.pullRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.tx.pullRequestMergeOperation.update).toHaveBeenCalledTimes(1);
    expect(fixture.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(fixture.storage.branchSha).toHaveBeenCalledTimes(1);
  });

  it('marks a storage-read failure retryable and releases the repository lock without changing Git refs', async () => {
    const fixture = makeFixture();
    fixture.db.pullRequestMergeOperation.findMany.mockResolvedValue([
      { operationId: fixture.operation.operationId, repositoryId: fixture.operation.repositoryId },
    ]);
    fixture.storage.branchSha.mockRejectedValueOnce(new Error('temporary Git storage failure'));

    await fixture.internals.reconcileMerges();

    expect(fixture.db.pullRequestMergeOperation.updateMany).toHaveBeenCalledWith({
      where: { operationId: 'operation-1', status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'RECONCILIATION_UNAVAILABLE' },
    });
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
    expect(fixture.lock.release).toHaveBeenCalledTimes(1);
    expect(fixture.storage.branchSha).toHaveBeenCalledTimes(1);
    expect(fixture.storage.isAncestor).not.toHaveBeenCalled();
  });

  it('leaves a merge pending for operator reconciliation if a push is also unresolved', async () => {
    const fixture = makeFixture();
    fixture.db.pullRequestMergeOperation.findMany.mockResolvedValue([
      { operationId: fixture.operation.operationId, repositoryId: fixture.operation.repositoryId },
    ]);
    fixture.pushJournal.assertNoUnresolvedPush.mockRejectedValueOnce(new ConflictException({
      error: { code: 'GIT_PUSH_RECONCILIATION_REQUIRED' },
    }));

    await fixture.internals.reconcileMerges();

    const mergeCalls = fixture.db.pullRequestMergeOperation.findMany.mock.calls as unknown as unknown[][];
    const query = mergeCalls[0]?.[0] as {
      where: {
        OR: Array<{ status?: string; createdAt?: { lte?: unknown } }>;
        AND: Array<{ OR: Array<{ errorCode: null | { not: string } }> }>;
      };
    } | undefined;
    expect(query?.where.OR[0]?.status).toBe('PENDING');
    const pendingCutoff = query?.where.OR[0]?.createdAt?.lte;
    expect(pendingCutoff).toBeInstanceOf(Date);
    const cutoffDelta = Date.now() - (pendingCutoff as Date).getTime();
    expect(cutoffDelta).toBeGreaterThanOrEqual(119_000);
    expect(cutoffDelta).toBeLessThanOrEqual(121_000);
    expect(query?.where.OR[1]?.status).toBe('NEEDS_RECONCILIATION');
    expect(query?.where.OR[1]?.createdAt).toBeUndefined();
    expect(query?.where.AND[0]?.OR).toEqual([
      { errorCode: null }, { errorCode: { not: 'CROSS_TYPE_OPERATION_UNRESOLVED' } },
    ]);
    expect(fixture.pushJournal.assertNoUnresolvedPush).toHaveBeenCalledWith(fixture.operation.repositoryId);
    expect(fixture.storage.branchSha).not.toHaveBeenCalled();
    expect(fixture.db.pullRequestMergeOperation.updateMany).toHaveBeenCalledWith({ where: {
      operationId: fixture.operation.operationId, status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] },
    }, data: { status: 'NEEDS_RECONCILIATION', errorCode: 'CROSS_TYPE_OPERATION_UNRESOLVED' } });
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
    expect(fixture.lock.release).toHaveBeenCalledTimes(1);
  });

  it('retries a transaction failure on the next reconciliation run and audits only the successful attempt', async () => {
    const fixture = makeFixture();
    fixture.db.pullRequestMergeOperation.findMany.mockResolvedValue([
      { operationId: fixture.operation.operationId, repositoryId: fixture.operation.repositoryId },
    ]);
    fixture.db.pullRequestMergeOperation.findUnique
      .mockResolvedValueOnce(fixture.operation)
      .mockResolvedValueOnce({ ...fixture.operation, status: 'NEEDS_RECONCILIATION' });
    fixture.db.$transaction.mockRejectedValueOnce(new Error('temporary database failure'));

    await fixture.internals.reconcileMerges();
    expect(fixture.db.pullRequestMergeOperation.updateMany).toHaveBeenCalledWith({
      where: { operationId: 'operation-1', status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'RECONCILIATION_UNAVAILABLE' },
    });
    expect(fixture.tx.auditLog.create).not.toHaveBeenCalled();
    expect(fixture.lock.release).toHaveBeenCalledTimes(1);

    await fixture.internals.reconcileMerges();

    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.tx.pullRequestMergeOperation.update).toHaveBeenCalledTimes(1);
    expect(fixture.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(fixture.lock.release).toHaveBeenCalledTimes(2);
  });

  it('completes metadata and audit only for a verified two-parent merge commit', async () => {
    const fixture = makeFixture({ pullRequest: { targetBranch: 'main', number: 1, mergedById: null } });
    await fixture.internals.reconcileOperation(fixture.operation.operationId);

    expect(fixture.db.$transaction).toHaveBeenCalledTimes(1);
    const mergeCalls = fixture.tx.pullRequest.updateMany.mock.calls as unknown as Array<[{
      data: { status: string; version: { increment: number }; mergedById: string; mergedAt: Date; mergeCommitSha: string };
    }] >;
    const mergeUpdate = mergeCalls[0]?.[0];
    expect(mergeUpdate?.data).toMatchObject({ status: 'MERGED', version: { increment: 1 }, mergedById: 'owner-1', mergeCommitSha: 'merge-sha' });
    expect(mergeUpdate?.data.mergedAt).toBeInstanceOf(Date);
    expect(fixture.tx.pullRequestMergeOperation.update).toHaveBeenCalledWith({ where: { operationId: 'operation-1' },
      data: { status: 'COMPLETED', resultingSha: 'merge-sha', errorCode: null } });
    expect(fixture.tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: 'owner-1', action: 'PULL_REQUEST_MERGE_RECONCILED',
      targetId: 'pull-1', details: { repositoryId: 'repository-1', number: 1, operationId: 'operation-1', mergeCommitSha: 'merge-sha' } } });
  });

  it('leaves metadata unresolved when the candidate commit has unexpected parents', async () => {
    const fixture = makeFixture();
    fixture.storage.commit.mockResolvedValue({ parentShas: ['target-old', 'unrelated-source'] });
    await fixture.internals.reconcileOperation(fixture.operation.operationId);

    expect(fixture.db.pullRequestMergeOperation.update).toHaveBeenCalledWith({ where: { operationId: 'operation-1' },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: 'CANDIDATE_PARENT_MISMATCH' } });
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });
});

import type { PrismaService } from '../database/prisma.service';
import type { GitStorageService } from '../repositories/git-storage.service';
import type { RepositoryLockService } from '../repositories/repository-lock.service';
import type { RepositoryPurgeService } from '../repositories/repository-purge.service';
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
  };
  const lock = { release: jest.fn().mockResolvedValue(undefined) };
  const locks = { acquire: jest.fn().mockResolvedValue(lock) };
  const storage = {
    branchSha: jest.fn().mockResolvedValue('merge-sha'),
    isAncestor: jest.fn().mockResolvedValue(true),
    commit: jest.fn().mockResolvedValue({ parentShas: ['target-old', 'source-sha'] }),
  };
  const purge = { purgeDue: jest.fn().mockResolvedValue(undefined) };
  const service = new MaintenanceJobsService(
    db as unknown as PrismaService,
    locks as unknown as RepositoryLockService,
    storage as unknown as GitStorageService,
    purge as unknown as RepositoryPurgeService,
  );
  const internals = service as unknown as {
    runScheduled: () => Promise<void>;
    reconcileOperation: (operationId: string) => Promise<void>;
  };
  return { service, internals, db, tx, locks, lock, storage, purge, operation: current };
}

describe('MaintenanceJobsService', () => {
  it('runs a batch on startup and clears its scheduled timer on shutdown', () => {
    jest.useFakeTimers();
    try {
      const fixture = makeFixture();
      const run = jest.spyOn(fixture.internals, 'runScheduled').mockResolvedValue(undefined);

      fixture.service.onModuleInit();
      expect(run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(2);

      fixture.service.onModuleDestroy();
      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
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

  it('completes metadata and audit only for a verified two-parent merge commit', async () => {
    const fixture = makeFixture();
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

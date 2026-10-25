import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RepositoryPolicy } from './repository.policy';
import { GitStorageService } from './git-storage.service';
import { PullRequestsService } from './pull-requests.service';
import { RepositoryLockService } from './repository-lock.service';

describe('PullRequestsService', () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const writerId = '22222222-2222-4222-8222-222222222222';
  const authorId = writerId;
  const repoId = '33333333-3333-4333-8333-333333333333';
  const pullId = '44444444-4444-4444-8444-444444444444';
  const operationId = '55555555-5555-4555-8555-555555555555';
  const sourceSha = 'a'.repeat(40);
  const targetSha = 'b'.repeat(40);

  let service: PullRequestsService;
  let db: {
    repository: { findFirst: jest.Mock; findUnique: jest.Mock };
    pullRequest: { findMany: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
    pullRequestMergeOperation: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    auditLog: { create: jest.Mock };
  };
  let storage: { compare: jest.Mock; createMergeCandidate: jest.Mock; assertMergeCandidateQuota: jest.Mock; compareAndSwapBranch: jest.Mock; branchSha: jest.Mock };
  let locks: { acquire: jest.Mock };
  let repo: { id: string; ownerId: string; status: string; deletedAt: null; storageGeneration: number; storageKey: string;
    owner: { username: string }; members: { userId: string; role: string }[] };
  let pullRequest: { id: string; repositoryId: string; number: number; authorId: string; status: string; version: number;
    storageGeneration: number; sourceSha: string; targetSha: string; sourceBranch: string; targetBranch: string;
    author: { id: string; username: string }; mergedBy: null };

  beforeEach(() => {
    repo = { id: repoId, ownerId, status: 'ACTIVE', deletedAt: null, storageGeneration: 2, storageKey: `${repoId}.git`,
      owner: { username: 'owner' }, members: [{ userId: writerId, role: 'WRITE' }] };
    pullRequest = { id: pullId, repositoryId: repoId, number: 4, authorId, status: 'OPEN', version: 3,
      storageGeneration: 2, sourceSha, targetSha, sourceBranch: 'feature/topic', targetBranch: 'main',
      author: { id: authorId, username: 'writer' }, mergedBy: null };
    db = {
      repository: { findFirst: jest.fn().mockResolvedValue(repo), findUnique: jest.fn().mockResolvedValue(repo) },
      pullRequest: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(pullRequest),
        findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
      pullRequestMergeOperation: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => Promise.resolve(callback(db))),
      auditLog: { create: jest.fn() },
    };
    storage = { compare: jest.fn().mockResolvedValue({ state: 'READY', sourceSha, targetSha, commits: [{ sha: sourceSha }], files: [], diff: '', diffTruncated: false }),
      createMergeCandidate: jest.fn().mockResolvedValue('d'.repeat(40)), assertMergeCandidateQuota: jest.fn().mockResolvedValue(undefined),
      compareAndSwapBranch: jest.fn(), branchSha: jest.fn().mockResolvedValue(targetSha) };
    locks = { acquire: jest.fn().mockResolvedValue({ signal: new AbortController().signal, release: jest.fn() }) };
    service = new PullRequestsService(db as unknown as PrismaService, new RepositoryPolicy(),
      storage as unknown as GitStorageService, locks as unknown as RepositoryLockService,
      { assertNoUnresolved: jest.fn().mockResolvedValue(undefined) } as never);
  });

  it('does not reveal pull requests for a private repository to a non-member', async () => {
    db.repository.findFirst.mockResolvedValueOnce({ ...repo, visibility: 'PRIVATE', members: [] });
    await expect(service.list('owner', 'repo')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.pullRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects an unchanged comparison before allocating a pull request number', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      repository: { findFirst: jest.fn().mockResolvedValue(repo), findUniqueOrThrow: jest.fn().mockResolvedValue(repo) },
      pullRequest: { create: jest.fn() },
    };
    db.$transaction.mockImplementationOnce((callback: (transaction: unknown) => unknown) => Promise.resolve(callback(tx)));
    storage.compare.mockResolvedValueOnce({ state: 'ALREADY_MERGED', sourceSha, targetSha, commits: [], files: [], diff: '', diffTruncated: false });
    await expect(service.create('owner', 'repo', writerId, { title: 'No change', sourceBranch: 'feature', targetBranch: 'main' }))
      .rejects.toMatchObject({ response: { error: { code: 'NO_CHANGES' } } });
    expect(tx.pullRequest.create).not.toHaveBeenCalled();
  });

  it('reports a stale snapshot when a branch has moved since PR creation', async () => {
    storage.compare.mockResolvedValueOnce({ state: 'READY', sourceSha: 'c'.repeat(40), targetSha, commits: [], files: [], diff: '', diffTruncated: false });
    const result = await service.compare('owner', 'repo', writerId, 4);
    expect(result).toMatchObject({ stale: true, sourceSha: 'c'.repeat(40), targetSha, storageGeneration: 2 });
  });

  it('returns the stored result for a completed merge operation without creating another merge', async () => {
    db.pullRequestMergeOperation.findUnique.mockResolvedValueOnce({ operationId, repositoryId: repoId, pullRequestId: pullId,
      expectedSourceSha: sourceSha, expectedTargetSha: targetSha, storageGeneration: 2, status: 'COMPLETED', resultingSha: 'd'.repeat(40) });
    const result = await service.merge('owner', 'repo', ownerId, 4, { operationId, expectedSourceSha: sourceSha,
      expectedTargetSha: targetSha, storageGeneration: 2, version: 3 });
    expect(result).toEqual({ status: 'MERGED', operationId, mergeCommitSha: 'd'.repeat(40) });
    expect(locks.acquire).not.toHaveBeenCalled();
    expect(storage.compareAndSwapBranch).not.toHaveBeenCalled();
  });

  it('rechecks the operation ID under the repository lock before allocating a merge', async () => {
    db.pullRequestMergeOperation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ operationId, repositoryId: repoId, pullRequestId: pullId,
        expectedSourceSha: sourceSha, expectedTargetSha: targetSha, storageGeneration: 2,
        status: 'COMPLETED', resultingSha: 'd'.repeat(40) });

    const result = await service.merge('owner', 'repo', ownerId, 4, { operationId, expectedSourceSha: sourceSha,
      expectedTargetSha: targetSha, storageGeneration: 2, version: 3 });

    expect(result).toEqual({ status: 'MERGED', operationId, mergeCommitSha: 'd'.repeat(40) });
    expect(locks.acquire).toHaveBeenCalledWith(repoId);
    expect(db.pullRequestMergeOperation.create).not.toHaveBeenCalled();
    expect(storage.compareAndSwapBranch).not.toHaveBeenCalled();
  });

  it('allows only the repository owner to merge a pull request', async () => {
    await expect(service.merge('owner', 'repo', writerId, 4, { operationId, expectedSourceSha: sourceSha,
      expectedTargetSha: targetSha, storageGeneration: 2, version: 3 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(locks.acquire).not.toHaveBeenCalled();
  });

  it('records a merge conflict without attempting to move the target ref', async () => {
    locks.acquire.mockResolvedValueOnce({ signal: new AbortController().signal, release: jest.fn() });
    storage.createMergeCandidate.mockRejectedValueOnce(new ConflictException({ error: { code: 'MERGE_CONFLICT' } }));
    await expect(service.merge('owner', 'repo', ownerId, 4, { operationId, expectedSourceSha: sourceSha,
      expectedTargetSha: targetSha, storageGeneration: 2, version: 3 })).rejects.toMatchObject({ response: { error: { code: 'MERGE_CONFLICT' } } });
    expect(db.pullRequestMergeOperation.create).toHaveBeenCalledTimes(1);
    expect(db.pullRequestMergeOperation.updateMany).toHaveBeenCalledTimes(1);
    expect(storage.compareAndSwapBranch).not.toHaveBeenCalled();
  });

  it('rejects a merge candidate over quota before moving the default branch', async () => {
    let failedOperationData: { status: string; errorCode: string } | undefined;
    db.pullRequestMergeOperation.updateMany.mockImplementationOnce((input: unknown) => {
      const data = (input as { data: { status: string; errorCode: string } }).data;
      failedOperationData = data;
      return Promise.resolve({ count: 1 });
    });
    storage.assertMergeCandidateQuota.mockRejectedValueOnce(new ConflictException({ error: { code: 'MERGE_FILE_QUOTA_EXCEEDED' } }));
    await expect(service.merge('owner', 'repo', ownerId, 4, { operationId, expectedSourceSha: sourceSha,
      expectedTargetSha: targetSha, storageGeneration: 2, version: 3 })).rejects.toMatchObject({ response: { error: { code: 'MERGE_FILE_QUOTA_EXCEEDED' } } });
    expect(storage.assertMergeCandidateQuota).toHaveBeenCalledWith(repo.storageKey, 'd'.repeat(40), expect.any(AbortSignal));
    expect(storage.compareAndSwapBranch).not.toHaveBeenCalled();
    expect(failedOperationData).toEqual({ status: 'FAILED', errorCode: 'MERGE_FILE_QUOTA_EXCEEDED' });
  });

  it('rechecks current WRITE membership under the repository lock before editing a pull request', async () => {
    db.repository.findUnique.mockResolvedValueOnce({ ...repo, members: [] });
    await expect(service.update('owner', 'repo', writerId, 4, { title: 'Still allowed?' })).rejects.toBeInstanceOf(NotFoundException);
    expect(locks.acquire).toHaveBeenCalledWith(repoId);
    expect(db.pullRequest.updateMany).not.toHaveBeenCalled();
  });
});

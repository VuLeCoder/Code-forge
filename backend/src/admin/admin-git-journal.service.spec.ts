import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { GitStorageService } from '../repositories/git-storage.service';
import type { RepositoryLockService } from '../repositories/repository-lock.service';
import { AdminGitJournalService } from './admin-git-journal.service';

describe('AdminGitJournalService', () => {
  const operationId = '11111111-1111-4111-8111-111111111111';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const actorId = '33333333-3333-4333-8333-333333333333';
  const adminId = '44444444-4444-4444-8444-444444444444';
  const revision = new Date('2026-10-28T10:00:00.000Z');
  const oldSha = 'a'.repeat(40);
  const newSha = 'b'.repeat(40);

  function fixture(kind: 'PUSH' | 'MERGE' = 'PUSH', overrides: Record<string, unknown> = {}) {
    const operation = {
      operationId, repositoryId, actorId, status: 'NEEDS_RECONCILIATION', storageGeneration: 7,
      beforeRefs: { 'refs/heads/main': oldSha }, changedRefCount: null, errorCode: 'GIT_CHILD_SUCCEEDED',
      createdAt: new Date('2026-10-28T09:00:00.000Z'), updatedAt: revision,
      repository: { id: repositoryId, storageGeneration: 7, storageKey: 'repo-key' },
      pullRequestId: '55555555-5555-4555-8555-555555555555', candidateSha: newSha,
      oldTargetSha: oldSha, expectedSourceSha: 'c'.repeat(40),
      pullRequest: { number: 3, targetBranch: 'main' },
      ...overrides,
    };
    const terminal = { status: kind === 'PUSH' ? 'COMPLETED' : 'FAILED', updatedAt: new Date('2026-10-28T10:01:00.000Z') };
    const release = jest.fn().mockResolvedValue(undefined);
    const auditCalls: unknown[] = [];
    const auditCreate = jest.fn((argument: unknown) => { auditCalls.push(argument); return Promise.resolve({}); });
    const pushFind = jest.fn();
    const mergeFind = jest.fn();
    if (kind === 'PUSH') pushFind.mockResolvedValueOnce({ repositoryId }).mockResolvedValueOnce(operation);
    else mergeFind.mockResolvedValueOnce({ repositoryId }).mockResolvedValueOnce(operation);
    const pushUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const mergeUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const pullCalls: unknown[] = [];
    const pullUpdate = jest.fn((argument: unknown) => { pullCalls.push(argument); return Promise.resolve({ count: 1 }); });
    const db = {
      user: { findUnique: jest.fn().mockResolvedValue({ systemRole: 'ADMIN', status: 'ACTIVE' }) },
      gitPushOperation: { findUnique: pushFind, count: jest.fn().mockResolvedValue(0), updateMany: pushUpdate,
        findUniqueOrThrow: jest.fn().mockResolvedValue(terminal) },
      pullRequestMergeOperation: { findUnique: mergeFind, count: jest.fn().mockResolvedValue(0), updateMany: mergeUpdate,
        findUniqueOrThrow: jest.fn().mockResolvedValue(terminal) },
      pullRequest: { updateMany: pullUpdate }, auditLog: { create: auditCreate },
    };
    const transaction = jest.fn((callback: (tx: typeof db) => unknown) => Promise.resolve(callback(db)));
    Object.assign(db, { $transaction: transaction });
    const storage = {
      exists: jest.fn().mockResolvedValue(true), snapshotRefs: jest.fn().mockResolvedValue({ 'refs/heads/main': newSha }),
      validateRef: jest.fn(), branchSha: jest.fn().mockResolvedValue(newSha), isAncestor: jest.fn().mockResolvedValue(true),
      commit: jest.fn().mockResolvedValue({ parentShas: [oldSha, operation.expectedSourceSha] }),
    };
    const locks = { acquire: jest.fn().mockResolvedValue({ release }) };
    const service = new AdminGitJournalService(db as unknown as PrismaService, storage as unknown as GitStorageService,
      locks as unknown as RepositoryLockService);
    return { service, operation, db, storage, locks, release, auditCreate, auditCalls, pushUpdate, mergeUpdate,
      pullUpdate, pullCalls };
  }

  it('rechecks active-admin permission under the repository lock', async () => {
    const f = fixture();
    f.db.user.findUnique.mockResolvedValueOnce({ systemRole: 'USER', status: 'ACTIVE' });

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toBeInstanceOf(ForbiddenException);

    expect(f.storage.exists).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale revision before reading Git evidence', async () => {
    const f = fixture('PUSH', { updatedAt: new Date(revision.getTime() + 1_000) });

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toMatchObject({
      response: { error: { code: 'GIT_JOURNAL_CHANGED' } },
    });

    expect(f.storage.exists).not.toHaveBeenCalled();
    expect(f.pushUpdate).not.toHaveBeenCalled();
  });

  it('keeps a push unresolved when changed refs cannot be attributed to a successful child', async () => {
    const f = fixture('PUSH', { errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN' });

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toMatchObject({
      response: { error: { code: 'GIT_OUTCOME_UNKNOWN' } },
    });

    expect(f.pushUpdate).not.toHaveBeenCalled();
    expect(f.auditCreate).not.toHaveBeenCalled();
  });

  it('atomically records a proven failed push and its resolving operator without exposing refs', async () => {
    const f = fixture();
    f.storage.snapshotRefs.mockResolvedValueOnce({ 'refs/heads/main': oldSha });

    const result = await f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' });

    expect(result).toMatchObject({ changed: true, journal: { type: 'PUSH', operationId }, resolutionCode: 'REFS_UNCHANGED' });
    expect(f.pushUpdate).toHaveBeenCalledWith({ where: { operationId, updatedAt: revision,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] }, storageGeneration: 7 }, data: {
      status: 'FAILED', errorCode: 'NO_REF_CHANGE', changedRefCount: null, beforeRefs: Prisma.DbNull,
    } });
    expect(f.auditCreate).toHaveBeenCalledTimes(1);
    expect(f.auditCreate).toHaveBeenCalledWith({ data: { actorId: adminId, action: 'ADMIN_GIT_JOURNAL_RESOLVED',
      targetId: repositoryId, details: { repositoryId, operationId, operationType: 'PUSH', outcome: 'FAILED',
        reasonCode: 'OPERATOR_REVIEW', resolutionCode: 'REFS_UNCHANGED', originalActorId: actorId, storageGeneration: 7 } } });
    expect(JSON.stringify(f.auditCreate.mock.calls)).not.toContain('refs/heads');
  });

  it('keeps a journal unresolved when another Git journal competes for attribution', async () => {
    const f = fixture();
    f.db.pullRequestMergeOperation.count.mockResolvedValueOnce(1);

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toMatchObject({
      response: { error: { code: 'COMPETING_GIT_JOURNAL' } },
    });

    expect(f.storage.exists).not.toHaveBeenCalled();
    expect(f.pushUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['generation mismatch', { storageGeneration: 6 }, 'STORAGE_GENERATION_CHANGED'],
    ['missing storage', {}, 'GIT_STORAGE_MISSING'],
  ] as const)('keeps a push unresolved for %s', async (_label, overrides, code) => {
    const f = fixture('PUSH', overrides);
    if (code === 'GIT_STORAGE_MISSING') f.storage.exists.mockResolvedValueOnce(false);

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toMatchObject({
      response: { error: { code } },
    });
    expect(f.pushUpdate).not.toHaveBeenCalled();
  });

  it('completes a merge only for a reachable candidate with the two recorded parents', async () => {
    const f = fixture('MERGE');
    const result = await f.service.resolve(adminId, 'MERGE', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' });

    expect(result).toMatchObject({ changed: true, resolutionCode: 'TWO_PARENT_CANDIDATE_REACHABLE' });
    expect(f.storage.isAncestor).toHaveBeenCalledWith('repo-key', newSha, newSha);
    const pullCall = f.pullCalls[0];
    expect(pullCall).toMatchObject({ where: { id: f.operation.pullRequestId, status: { not: 'MERGED' } },
      data: { status: 'MERGED', version: { increment: 1 }, mergedById: actorId, mergeCommitSha: newSha } });
    expect((pullCall as { data: { mergedAt: unknown } }).data.mergedAt).toBeInstanceOf(Date);
    expect(f.auditCreate).toHaveBeenCalledTimes(2);
    const resolutionAudit = f.auditCalls[1];
    expect(resolutionAudit).toMatchObject({ data: { actorId: adminId, action: 'ADMIN_GIT_JOURNAL_RESOLVED',
      details: { originalActorId: actorId, operationType: 'MERGE', outcome: 'COMPLETED' } } });
  });

  it('does not mutate metadata for a merge candidate with contradictory parents', async () => {
    const f = fixture('MERGE');
    f.storage.commit.mockResolvedValueOnce({ parentShas: [oldSha, 'd'.repeat(40)] });

    await expect(f.service.resolve(adminId, 'MERGE', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toMatchObject({
      response: { error: { code: 'MERGE_CANDIDATE_MISMATCH' } },
    });
    expect(f.mergeUpdate).not.toHaveBeenCalled();
    expect(f.pullUpdate).not.toHaveBeenCalled();
  });

  it('treats retrying an already-terminal resolution as an idempotent no-op', async () => {
    const f = fixture('PUSH', { status: 'COMPLETED' });

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).resolves.toMatchObject({
      changed: false, journal: { type: 'PUSH', operationId, status: 'COMPLETED' },
    });
    expect(f.storage.exists).not.toHaveBeenCalled();
    expect(f.auditCreate).not.toHaveBeenCalled();
  });

  it('leaves an unresolved operation unchanged if the atomic revision compare loses a race', async () => {
    const f = fixture();
    f.pushUpdate.mockResolvedValueOnce({ count: 0 });

    await expect(f.service.resolve(adminId, 'PUSH', operationId,
      { revision: revision.toISOString(), reasonCode: 'OPERATOR_REVIEW' })).rejects.toBeInstanceOf(ConflictException);
    expect(f.auditCreate).not.toHaveBeenCalled();
  });
});

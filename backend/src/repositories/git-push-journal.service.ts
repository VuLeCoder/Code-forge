import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GitStorageService } from './git-storage.service';
import { RepositoryLockService } from './repository-lock.service';

const UNRESOLVED = ['PENDING', 'NEEDS_RECONCILIATION'] as const;
const RECONCILIATION_GRACE_MS = 120_000;
const CHILD_UNKNOWN = 'GIT_CHILD_OUTCOME_UNKNOWN';
const CHILD_SUCCEEDED = 'GIT_CHILD_SUCCEEDED';
const CHILD_FAILED = 'GIT_CHILD_FAILED';

@Injectable()
export class GitPushJournalService {
  constructor(private readonly db: PrismaService, private readonly storage: GitStorageService,
    private readonly locks: RepositoryLockService) {}

  async assertNoUnresolved(repositoryId: string) {
    await this.assertNoUnresolvedPush(repositoryId);
    await this.assertNoUnresolvedMerge(repositoryId);
  }

  async assertNoUnresolvedPush(repositoryId: string) {
    const unresolved = await this.db.gitPushOperation.count({ where: { repositoryId, status: { in: [...UNRESOLVED] } } });
    if (unresolved) throw new ConflictException({ error: {
      code: 'GIT_PUSH_RECONCILIATION_REQUIRED',
      message: 'Một lần push trước đó cần được đối soát trước khi thay đổi repository.', details: {},
    } });
  }

  async assertNoUnresolvedMerge(repositoryId: string) {
    const unresolved = await this.db.pullRequestMergeOperation.count({ where: { repositoryId, status: { in: [...UNRESOLVED] } } });
    if (unresolved) throw new ConflictException({ error: {
      code: 'MERGE_RECONCILIATION_REQUIRED',
      message: 'Một lần merge trước đó cần được đối soát trước khi thay đổi repository.', details: {},
    } });
  }

  async begin(repositoryId: string, actorId: string, storageGeneration: number, beforeRefs: Record<string, string>) {
    await this.assertNoUnresolved(repositoryId);
    return this.db.gitPushOperation.create({ data: { operationId: randomUUID(), repositoryId, actorId, storageGeneration,
      beforeRefs, errorCode: CHILD_UNKNOWN } });
  }

  async recordChildSuccess(operationId: string) {
    const updated = await this.db.gitPushOperation.updateMany({ where: { operationId, status: 'PENDING', errorCode: CHILD_UNKNOWN },
      data: { errorCode: CHILD_SUCCEEDED } });
    return updated.count === 1;
  }

  async markChildFailed(operationId: string) {
    await this.db.gitPushOperation.updateMany({ where: { operationId, status: { in: [...UNRESOLVED] }, errorCode: CHILD_UNKNOWN },
      data: { status: 'NEEDS_RECONCILIATION', errorCode: CHILD_FAILED } });
  }

  async finish(operationId: string, afterRefs: Record<string, string>) {
    const operation = await this.db.gitPushOperation.findUnique({ where: { operationId }, include: { repository: true } });
    if (!operation || !UNRESOLVED.includes(operation.status as typeof UNRESOLVED[number]) || operation.errorCode !== CHILD_SUCCEEDED) return false;
    if (operation.storageGeneration !== operation.repository.storageGeneration) {
      await this.markNeedsReconciliation(operationId);
      return false;
    }
    const beforeRefs = this.readSnapshot(operation.beforeRefs);
    const changedRefCount = this.changedRefCount(beforeRefs, afterRefs);
    if (changedRefCount === 0) {
      await this.db.gitPushOperation.updateMany({ where: { operationId, status: { in: [...UNRESOLVED] }, errorCode: CHILD_SUCCEEDED },
        data: { status: 'FAILED', errorCode: 'NO_REF_CHANGE', beforeRefs: Prisma.DbNull } });
      return true;
    }
    return this.complete(operation, changedRefCount);
  }

  async fail(operationId: string, errorCode: string) {
    await this.db.gitPushOperation.updateMany({ where: { operationId, status: 'PENDING' },
      data: { status: 'FAILED', errorCode: this.safeErrorCode(errorCode), beforeRefs: Prisma.DbNull } });
  }

  async markNeedsReconciliation(operationId: string) {
    // Retryable failures must not erase the durable child-outcome proof.
    await this.db.gitPushOperation.updateMany({ where: { operationId, status: { in: [...UNRESOLVED] } },
      data: { status: 'NEEDS_RECONCILIATION' } });
  }

  async reconcilePending(limit = 25) {
    const cutoff = new Date(Date.now() - RECONCILIATION_GRACE_MS);
    const operations = await this.db.gitPushOperation.findMany({
      where: { status: { in: [...UNRESOLVED] }, createdAt: { lte: cutoff }, errorCode: CHILD_SUCCEEDED },
      orderBy: [{ updatedAt: 'asc' }, { operationId: 'asc' }], take: limit,
      select: { operationId: true, repositoryId: true },
    });
    for (const item of operations) {
      let lock: Awaited<ReturnType<RepositoryLockService['acquire']>> | undefined;
      try {
        lock = await this.locks.acquire(item.repositoryId);
        await this.assertNoUnresolvedMerge(item.repositoryId);
        await this.reconcileOne(item.operationId);
      } catch {
        await this.markNeedsReconciliation(item.operationId).catch(() => undefined);
      } finally { if (lock) await lock.release(); }
    }
  }

  private async reconcileOne(operationId: string) {
    const operation = await this.db.gitPushOperation.findUnique({ where: { operationId }, include: { repository: true } });
    if (!operation || !UNRESOLVED.includes(operation.status as typeof UNRESOLVED[number]) || operation.errorCode !== CHILD_SUCCEEDED) return;
    if (operation.storageGeneration !== operation.repository.storageGeneration) {
      await this.markNeedsReconciliation(operationId);
      return;
    }
    if (!(await this.storage.exists(operation.repository.storageKey))) {
      await this.markNeedsReconciliation(operationId);
      return;
    }
    const beforeRefs = this.readSnapshot(operation.beforeRefs);
    const afterRefs = await this.storage.snapshotRefs(operation.repository.storageKey);
    const changedRefCount = this.changedRefCount(beforeRefs, afterRefs);
    if (changedRefCount === 0) {
      await this.db.gitPushOperation.updateMany({ where: { operationId, status: { in: [...UNRESOLVED] }, errorCode: CHILD_SUCCEEDED },
        data: { status: 'FAILED', errorCode: 'NO_REF_CHANGE', beforeRefs: Prisma.DbNull } });
      return;
    }
    await this.complete(operation, changedRefCount);
  }

  private async complete(operation: { operationId: string; repositoryId: string; actorId: string; storageGeneration: number }, changedRefCount: number) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.gitPushOperation.updateMany({ where: { operationId: operation.operationId,
        status: { in: [...UNRESOLVED] }, storageGeneration: operation.storageGeneration, errorCode: CHILD_SUCCEEDED },
        data: { status: 'COMPLETED', changedRefCount, errorCode: null, beforeRefs: Prisma.DbNull } });
      if (!updated.count) return false;
      await tx.auditLog.create({ data: { actorId: operation.actorId, action: 'GIT_PUSH_COMPLETED', targetId: operation.repositoryId,
        details: { operationId: operation.operationId, repositoryId: operation.repositoryId,
          storageGeneration: operation.storageGeneration, changedRefCount } } });
      return true;
    });
  }

  private readSnapshot(value: Prisma.JsonValue): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Git ref snapshot');
    const refs = Object.create(null) as Record<string, string>;
    for (const [ref, sha] of Object.entries(value)) {
      if (!ref.startsWith('refs/heads/') || typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
        throw new Error('Invalid Git ref snapshot');
      }
      try { this.storage.validateRef(ref.slice('refs/heads/'.length)); }
      catch { throw new Error('Invalid Git ref snapshot'); }
      refs[ref] = sha;
    }
    return refs;
  }

  private changedRefCount(before: Record<string, string>, after: Record<string, string>) {
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);
    let changed = 0;
    for (const ref of names) if (before[ref] !== after[ref]) changed++;
    return changed;
  }

  private safeErrorCode(value: string) { return /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'GIT_PUSH_FAILED'; }
}

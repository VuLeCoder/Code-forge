import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GitStorageService } from '../repositories/git-storage.service';
import { RepositoryLockService } from '../repositories/repository-lock.service';
import { RepositoryPurgeService } from '../repositories/repository-purge.service';
import { GitPushJournalService } from '../repositories/git-push-journal.service';

const CROSS_TYPE_UNRESOLVED = 'CROSS_TYPE_OPERATION_UNRESOLVED';
const MERGE_RECONCILIATION_GRACE_MS = 120_000;

@Injectable()
export class MaintenanceJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceJobsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private activeRun?: Promise<void>;

  constructor(private readonly db: PrismaService, private readonly locks: RepositoryLockService,
    private readonly storage: GitStorageService, private readonly purge: RepositoryPurgeService,
    private readonly pushJournal: GitPushJournalService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runOnce(), 60_000);
    this.timer.unref();
    void this.runOnce();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.activeRun;
  }

  /** Runs one maintenance batch or awaits the in-flight batch. */
  runOnce() {
    if (this.activeRun) return this.activeRun;
    const run = this.runScheduled();
    this.activeRun = run;
    void run.then(() => {
      if (this.activeRun === run) this.activeRun = undefined;
    }, () => {
      if (this.activeRun === run) this.activeRun = undefined;
    });
    return run;
  }

  private async runScheduled() {
    if (this.running) return;
    this.running = true;
    let jobLock: Awaited<ReturnType<RepositoryLockService['acquire']>> | undefined;
    try {
      jobLock = await this.locks.acquire('code-forge-maintenance-jobs');
      await this.expireInvitations();
      await this.cleanupExpiredCredentials();
      await this.pushJournal.reconcilePending();
      await this.reconcileMerges();
      await this.purge.purgeDue(50);
      await this.storage.cleanupOrphanedTemporaryDirectories();
    } catch {
      // Logs identify only the job and never include database URLs or row data.
      this.logger.warn('Maintenance batch failed; it will retry on the next run.');
    } finally {
      try {
        if (jobLock) await jobLock.release();
      } catch {
        // The lock service discards a connection whose advisory unlock failed.
        this.logger.warn('Maintenance lock release failed; it will retry on the next run.');
      } finally {
        this.running = false;
      }
    }
  }

  private async expireInvitations() {
    await this.db.$executeRaw`
      UPDATE invitations SET status = 'EXPIRED', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM invitations
        WHERE status = 'PENDING' AND expires_at <= NOW()
        ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
      )`;
  }

  private async cleanupExpiredCredentials() {
    await this.db.$executeRaw`
      DELETE FROM sessions WHERE id IN (
        SELECT id FROM sessions
        WHERE (expires_at < NOW() - INTERVAL '30 days') OR (revoked_at < NOW() - INTERVAL '30 days')
        ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
      )`;
    await this.db.$executeRaw`
      DELETE FROM personal_access_tokens WHERE id IN (
        SELECT id FROM personal_access_tokens
        WHERE (expires_at < NOW() - INTERVAL '90 days') OR (revoked_at < NOW() - INTERVAL '90 days')
        ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
      )`;
  }

  private async reconcileMerges() {
    const cutoff = new Date(Date.now() - MERGE_RECONCILIATION_GRACE_MS);
    const candidates = await this.db.pullRequestMergeOperation.findMany({
      where: { OR: [
        { status: 'PENDING', createdAt: { lte: cutoff } },
        { status: 'NEEDS_RECONCILIATION' },
      ], AND: [{ OR: [{ errorCode: null }, { errorCode: { not: CROSS_TYPE_UNRESOLVED } }] }] },
      orderBy: [{ updatedAt: 'asc' }, { operationId: 'asc' }], take: 25,
      select: { operationId: true, repositoryId: true },
    });
    for (const candidate of candidates) {
      const lock = await this.locks.acquire(candidate.repositoryId);
      try {
        await this.pushJournal.assertNoUnresolvedPush(candidate.repositoryId);
        await this.reconcileOperation(candidate.operationId);
      } catch (error) {
        const response = (error as { getResponse?: () => unknown } | null)?.getResponse?.();
        const body = response && typeof response === 'object' && 'error' in response
          ? (response as { error?: unknown }).error : undefined;
        const code = body && typeof body === 'object' && 'code' in body ? (body as { code?: unknown }).code : undefined;
        await this.db.pullRequestMergeOperation.updateMany({ where: { operationId: candidate.operationId,
          status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } },
          data: { status: 'NEEDS_RECONCILIATION', errorCode: code === 'GIT_PUSH_RECONCILIATION_REQUIRED'
            ? CROSS_TYPE_UNRESOLVED : 'RECONCILIATION_UNAVAILABLE' } }).catch(() => undefined);
      } finally { await lock.release(); }
    }
  }

  private async reconcileOperation(operationId: string) {
    const operation = await this.db.pullRequestMergeOperation.findUnique({ where: { operationId }, include: { repository: true, pullRequest: true } });
    if (!operation || !['PENDING', 'NEEDS_RECONCILIATION'].includes(operation.status)) return;
    if (operation.storageGeneration !== operation.repository.storageGeneration) {
      await this.db.pullRequestMergeOperation.update({ where: { operationId }, data: { status: 'NEEDS_RECONCILIATION', errorCode: 'STORAGE_GENERATION_CHANGED' } });
      return;
    }
    const actualTarget = await this.storage.branchSha(operation.repository.storageKey, operation.pullRequest.targetBranch);
    if (actualTarget === operation.oldTargetSha) {
      await this.db.pullRequestMergeOperation.update({ where: { operationId }, data: { status: 'FAILED', errorCode: 'REF_NOT_UPDATED' } });
      return;
    }
    if (!operation.candidateSha || !actualTarget || !(await this.storage.isAncestor(operation.repository.storageKey, operation.candidateSha, actualTarget))) {
      await this.db.pullRequestMergeOperation.update({ where: { operationId }, data: { status: 'NEEDS_RECONCILIATION', errorCode: 'REF_OUTCOME_UNKNOWN' } });
      return;
    }
    const candidate = await this.storage.commit(operation.repository.storageKey, operation.candidateSha);
    if (candidate.parentShas.length !== 2 || candidate.parentShas[0] !== operation.oldTargetSha || candidate.parentShas[1] !== operation.expectedSourceSha) {
      await this.db.pullRequestMergeOperation.update({ where: { operationId }, data: { status: 'NEEDS_RECONCILIATION', errorCode: 'CANDIDATE_PARENT_MISMATCH' } });
      return;
    }
    await this.db.$transaction(async (tx) => {
      await tx.pullRequest.updateMany({ where: { id: operation.pullRequestId, status: { not: 'MERGED' } },
        data: { status: 'MERGED', version: { increment: 1 }, mergedById: operation.actorId,
          mergedAt: new Date(), mergeCommitSha: operation.candidateSha } });
      await tx.pullRequestMergeOperation.update({ where: { operationId }, data: { status: 'COMPLETED', resultingSha: operation.candidateSha, errorCode: null } });
      await tx.auditLog.create({ data: { actorId: operation.actorId,
        action: 'PULL_REQUEST_MERGE_RECONCILED', targetId: operation.pullRequestId,
        details: { repositoryId: operation.repositoryId, number: operation.pullRequest.number, operationId, mergeCommitSha: operation.candidateSha } } });
    });
  }
}

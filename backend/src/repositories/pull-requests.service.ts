import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PullRequestStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RepositoryPolicy } from './repository.policy';
import { GitStorageService } from './git-storage.service';
import { CreatePullRequestDto, MergePullRequestDto, UpdatePullRequestDto } from './pull-request.dto';
import { RepositoryLockService } from './repository-lock.service';
import { GitPushJournalService } from './git-push-journal.service';

@Injectable()
export class PullRequestsService {
  constructor(private readonly db: PrismaService, private readonly policy: RepositoryPolicy,
    private readonly storage: GitStorageService, private readonly locks: RepositoryLockService,
    private readonly pushJournal: GitPushJournalService) {}

  private async repository(owner: string, name: string, userId?: string) {
    const repo = await this.db.repository.findFirst({
      where: { normalizedName: name.toLowerCase(), owner: { normalizedUsername: owner.toLowerCase() } },
      include: { owner: { select: { username: true } }, members: { where: { userId: userId ?? '00000000-0000-0000-0000-000000000000' } } },
    });
    this.policy.assertRead(repo, userId);
    return repo;
  }

  private permission(repo: { ownerId: string; members: { userId: string; role: string }[] }, userId?: string, authorId?: string) {
    const canWrite = !!userId && (repo.ownerId === userId || repo.members.some((member) => member.userId === userId && member.role === 'WRITE'));
    return { canCreate: canWrite, canEdit: canWrite && !!authorId && (authorId === userId || repo.ownerId === userId),
      canMerge: !!userId && repo.ownerId === userId };
  }

  private nextPage(page?: string) {
    if (page !== undefined && (!/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 1000)) {
      throw new BadRequestException({ error: { code: 'INVALID_PAGE', message: 'Trang phải từ 1 đến 1000.' } });
    }
    return page === undefined ? 1 : Number(page);
  }

  async list(owner: string, name: string, userId?: string, pageRaw?: string, status?: PullRequestStatus) {
    const page = this.nextPage(pageRaw);
    const repo = await this.repository(owner, name, userId);
    const rows = await this.db.pullRequest.findMany({ where: { repositoryId: repo.id, ...(status ? { status } : {}) },
      include: { author: { select: { id: true, username: true } } }, orderBy: [{ number: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 });
    return { pullRequests: rows.slice(0, 20), page, pageSize: 20, hasMore: rows.length > 20,
      permissions: { canCreate: this.permission(repo, userId).canCreate } };
  }

  async create(owner: string, name: string, userId: string, dto: CreatePullRequestDto) {
    if (dto.sourceBranch === dto.targetBranch) throw new BadRequestException({ error: { code: 'SAME_BRANCH', message: 'Branch nguồn và đích phải khác nhau.' } });
    const initial = await this.repository(owner, name, userId);
    const lock = await this.locks.acquire(initial.id);
    try {
      await this.pushJournal.assertNoUnresolved(initial.id);
      return await this.db.$transaction(async (tx) => {
        const users = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (users[0]?.status !== 'ACTIVE') throw new ForbiddenException();
        const found = await tx.repository.findFirst({
          where: { normalizedName: name.toLowerCase(), owner: { normalizedUsername: owner.toLowerCase() } },
          include: { owner: { select: { username: true } }, members: { where: { userId } } },
        });
        this.policy.assertWrite(found, userId);
        await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${found.id}::uuid FOR UPDATE`;
        const repo = await tx.repository.findUniqueOrThrow({ where: { id: found.id }, include: { members: { where: { userId } } } });
        this.policy.assertWrite(repo, userId);
        const snapshot = await this.storage.compare(repo.storageKey, dto.sourceBranch, dto.targetBranch);
        if (snapshot.state === 'NO_MERGE_BASE') throw new ConflictException({ error: { code: 'NO_MERGE_BASE', message: 'Branch không có merge-base chung.' } });
        if (snapshot.state === 'ALREADY_MERGED' || !snapshot.commits.length) throw new ConflictException({ error: { code: 'NO_CHANGES', message: 'Branch nguồn không có commit mới.' } });
        const rows = await tx.$queryRaw<{ number: number }[]>`SELECT COALESCE(MAX(number), 0)::int + 1 AS number FROM pull_requests WHERE repository_id = ${repo.id}::uuid`;
        const number = rows[0]?.number;
        if (!Number.isSafeInteger(number) || number! < 1) throw new ConflictException({ error: { code: 'PULL_REQUEST_NUMBER_UNAVAILABLE', message: 'Không thể cấp số pull request.' } });
        const pullRequest = await tx.pullRequest.create({ data: { repositoryId: repo.id, number: number!, authorId: userId,
          title: dto.title, description: dto.description, sourceBranch: dto.sourceBranch, targetBranch: dto.targetBranch,
          storageGeneration: repo.storageGeneration, sourceSha: snapshot.sourceSha, targetSha: snapshot.targetSha },
          include: { author: { select: { id: true, username: true } } } });
        await tx.auditLog.create({ data: { actorId: userId, action: 'PULL_REQUEST_CREATED', targetId: pullRequest.id,
          details: { repositoryId: repo.id, number: pullRequest.number } } });
        return { pullRequest, permissions: this.permission(repo, userId, userId) };
      }, { timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: { code: 'OPEN_PULL_REQUEST_EXISTS', message: 'Đã có pull request đang mở cho cặp branch này.' } });
      }
      throw error;
    } finally {
      await lock.release();
    }
  }

  async detail(owner: string, name: string, userId: string | undefined, number: number) {
    const repo = await this.repository(owner, name, userId);
    const pullRequest = await this.db.pullRequest.findUnique({ where: { repositoryId_number: { repositoryId: repo.id, number } },
      include: { author: { select: { id: true, username: true } }, mergedBy: { select: { id: true, username: true } } } });
    if (!pullRequest) throw new NotFoundException({ error: { code: 'PULL_REQUEST_NOT_FOUND', message: 'Không tìm thấy pull request.' } });
    const mergeOperation = await this.db.pullRequestMergeOperation.findFirst({ where: { pullRequestId: pullRequest.id },
      orderBy: { createdAt: 'desc' }, select: { operationId: true, status: true, errorCode: true } });
    return { pullRequest, permissions: this.permission(repo, userId, pullRequest.authorId), mergeOperation };
  }

  async compare(owner: string, name: string, userId: string | undefined, number: number) {
    const repoBefore = await this.repository(owner, name, userId);
    const lock = await this.locks.acquire(repoBefore.id);
    try {
      const { pullRequest } = await this.detail(owner, name, userId, number);
      const repo = await this.repository(owner, name, userId);
      if (pullRequest.storageGeneration !== repo.storageGeneration) {
        return { state: 'STORAGE_RESET' as const, sourceSha: pullRequest.sourceSha, targetSha: pullRequest.targetSha,
          storageGeneration: repo.storageGeneration, commits: [], files: [], diff: '', diffTruncated: false };
      }
      const current = await this.storage.compare(repo.storageKey, pullRequest.sourceBranch, pullRequest.targetBranch, lock.signal);
      return { ...current, storageGeneration: repo.storageGeneration,
        stale: current.sourceSha !== pullRequest.sourceSha || current.targetSha !== pullRequest.targetSha };
    } finally { await lock.release(); }
  }

  async update(owner: string, name: string, userId: string, number: number, dto: UpdatePullRequestDto) {
    if (dto.title === undefined && dto.description === undefined && dto.state === undefined) {
      throw new BadRequestException({ error: { code: 'EMPTY_UPDATE', message: 'Cần ít nhất một trường để cập nhật.' } });
    }
    const initial = await this.repository(owner, name, userId);
    const lock = await this.locks.acquire(initial.id);
    try {
      await this.pushJournal.assertNoUnresolved(initial.id);
      await this.db.$transaction(async (tx) => {
        const users = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (users[0]?.status !== 'ACTIVE') throw new ForbiddenException();
        await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${initial.id}::uuid FOR UPDATE`;
        const repo = await tx.repository.findUnique({ where: { id: initial.id }, include: { members: { where: { userId } } } });
        this.policy.assertWrite(repo, userId);
        const current = await tx.pullRequest.findUnique({ where: { repositoryId_number: { repositoryId: initial.id, number } } });
        if (!current) throw new NotFoundException({ error: { code: 'PULL_REQUEST_NOT_FOUND', message: 'Không tìm thấy pull request.' } });
        if (!this.permission(repo, userId, current.authorId).canEdit) {
          throw new ForbiddenException({ error: { code: 'PULL_REQUEST_FORBIDDEN', message: 'Bạn không thể sửa pull request này.' } });
        }
        if (dto.state && current.status === 'MERGED') throw new ConflictException({ error: { code: 'PULL_REQUEST_ALREADY_MERGED', message: 'Pull request đã merge và không thể đổi trạng thái.' } });
        if (dto.state === 'OPEN' && current.status === 'CLOSED') {
          const duplicate = await tx.pullRequest.findFirst({ where: { repositoryId: repo.id, sourceBranch: current.sourceBranch,
            targetBranch: current.targetBranch, status: 'OPEN' } });
          if (duplicate) throw new ConflictException({ error: { code: 'OPEN_PULL_REQUEST_EXISTS', message: 'Đã có pull request đang mở cho cặp branch này.' } });
        }
        const updated = await tx.pullRequest.updateMany({ where: { id: current.id, version: current.version },
          data: { title: dto.title, description: dto.description, status: dto.state, version: { increment: 1 } } });
        if (!updated.count) throw new ConflictException({ error: { code: 'PULL_REQUEST_CHANGED', message: 'Pull request đã thay đổi. Hãy tải lại.' } });
        await tx.auditLog.create({ data: { actorId: userId, action: 'PULL_REQUEST_UPDATED', targetId: current.id,
          details: { repositoryId: repo.id, number, from: current.status, to: dto.state ?? current.status } } });
      }, { timeout: 30_000 });
      return this.detail(owner, name, userId, number);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: { code: 'OPEN_PULL_REQUEST_EXISTS', message: 'Đã có pull request đang mở cho cặp branch này.' } });
      }
      throw error;
    } finally {
      await lock.release();
    }
  }

  async merge(owner: string, name: string, userId: string, number: number, dto: MergePullRequestDto) {
    const first = await this.detail(owner, name, userId, number);
    if (!first.permissions.canMerge) throw new ForbiddenException({ error: { code: 'MERGE_FORBIDDEN', message: 'Chỉ owner repository được merge.' } });
    const repoId = first.pullRequest.repositoryId;
    const replayExistingOperation = async () => {
      const existing = await this.db.pullRequestMergeOperation.findUnique({ where: { operationId: dto.operationId } });
      if (!existing) return undefined;
      if (existing.repositoryId !== repoId || existing.pullRequestId !== first.pullRequest.id ||
        existing.expectedSourceSha !== dto.expectedSourceSha || existing.expectedTargetSha !== dto.expectedTargetSha ||
        existing.storageGeneration !== dto.storageGeneration) throw new ConflictException({ error: { code: 'OPERATION_ID_REUSED', message: 'Operation ID đã được dùng cho yêu cầu khác.' } });
      if (existing.status === 'COMPLETED') return { status: 'MERGED', operationId: dto.operationId, mergeCommitSha: existing.resultingSha };
      if (existing.status === 'PENDING' || existing.status === 'NEEDS_RECONCILIATION') return { status: 'RECONCILING', operationId: dto.operationId };
      throw new ConflictException({ error: { code: 'MERGE_OPERATION_FAILED', message: 'Thao tác merge này đã thất bại; cần tạo operation ID mới.' } });
    };
    const existingResult = await replayExistingOperation();
    if (existingResult) return existingResult;

    const lock = await this.locks.acquire(repoId);
    try {
      await this.pushJournal.assertNoUnresolved(repoId);
      const users = await this.db.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid`;
      if (users[0]?.status !== 'ACTIVE') throw new ForbiddenException();
      const repo = await this.db.repository.findUnique({ where: { id: repoId } });
      if (!repo || repo.ownerId !== userId || repo.status !== 'ACTIVE' || repo.deletedAt !== null) {
        throw new ForbiddenException({ error: { code: 'MERGE_FORBIDDEN', message: 'Chỉ owner repository đang hoạt động được merge.' } });
      }
      // A same-repository retry may have passed the optimistic lookup above while
      // another request held this lock. Re-read under the lock before checking PR
      // state or allocating a second durable operation.
      const lockedExistingResult = await replayExistingOperation();
      if (lockedExistingResult) return lockedExistingResult;
      const pullRequest = await this.db.pullRequest.findUnique({ where: { id: first.pullRequest.id } });
      if (!pullRequest || pullRequest.status !== 'OPEN') throw new ConflictException({ error: { code: 'PULL_REQUEST_NOT_OPEN', message: 'Pull request không còn mở.' } });
      const unresolved = await this.db.pullRequestMergeOperation.count({ where: { repositoryId: repo.id,
        status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } } });
      if (unresolved) throw new ConflictException({ error: { code: 'MERGE_RECONCILIATION_REQUIRED', message: 'Một merge trước đó cần được đối soát trước khi merge tiếp.' } });
      if (pullRequest.version !== dto.version || repo.storageGeneration !== dto.storageGeneration ||
        pullRequest.storageGeneration !== dto.storageGeneration) throw new ConflictException({ error: { code: 'STALE_COMPARE', message: 'Pull request hoặc storage đã thay đổi. Hãy tải lại diff.' } });
      const snapshot = await this.storage.compare(repo.storageKey, pullRequest.sourceBranch, pullRequest.targetBranch, lock.signal);
      if (snapshot.state === 'NO_MERGE_BASE') throw new ConflictException({ error: { code: 'NO_MERGE_BASE', message: 'Branch không còn merge-base chung.' } });
      if (snapshot.state !== 'READY' || snapshot.sourceSha !== dto.expectedSourceSha || snapshot.targetSha !== dto.expectedTargetSha) {
        throw new ConflictException({ error: { code: 'STALE_COMPARE', message: 'Branch đã thay đổi. Hãy tải lại diff.' } });
      }
      try {
        await this.db.pullRequestMergeOperation.create({ data: { operationId: dto.operationId, repositoryId: repo.id,
          pullRequestId: pullRequest.id, actorId: userId, storageGeneration: dto.storageGeneration, expectedSourceSha: dto.expectedSourceSha,
          expectedTargetSha: dto.expectedTargetSha, oldTargetSha: dto.expectedTargetSha, status: 'PENDING' } });
      } catch (error) {
        // Operation IDs are globally unique. Requests using the same ID against
        // different repositories do not share a repository lock, so resolve a
        // concurrent unique-key winner through the same idempotent replay path.
        const concurrentResult = await replayExistingOperation();
        if (concurrentResult) return concurrentResult;
        throw error;
      }

      let candidateSha: string | undefined;
      try {
        candidateSha = await this.storage.createMergeCandidate(repo.storageKey, pullRequest.targetBranch,
          dto.expectedTargetSha, dto.expectedSourceSha, pullRequest.number, lock.signal);
        await this.storage.assertMergeCandidateQuota(repo.storageKey, candidateSha, lock.signal);
        await this.db.pullRequestMergeOperation.update({ where: { operationId: dto.operationId }, data: { candidateSha } });
        await this.storage.compareAndSwapBranch(repo.storageKey, pullRequest.targetBranch, candidateSha, dto.expectedTargetSha, lock.signal);
      } catch (error) {
        const actualTarget = await this.storage.branchSha(repo.storageKey, pullRequest.targetBranch).catch(() => undefined);
        const safelyUnchanged = actualTarget === dto.expectedTargetSha;
        await this.db.pullRequestMergeOperation.updateMany({ where: { operationId: dto.operationId, status: 'PENDING' },
          data: safelyUnchanged ? { status: 'FAILED', errorCode: (error as { response?: { error?: { code?: string } } }).response?.error?.code ?? 'MERGE_FAILED' }
            : { status: 'NEEDS_RECONCILIATION', errorCode: 'MERGE_OUTCOME_UNKNOWN' } });
        if (!safelyUnchanged) return { status: 'RECONCILING', operationId: dto.operationId };
        throw error;
      }

      try {
        await this.db.$transaction(async (tx) => {
          const updated = await tx.pullRequest.updateMany({ where: { id: pullRequest.id, version: dto.version, status: 'OPEN' },
            data: { status: 'MERGED', version: { increment: 1 }, mergedById: userId, mergedAt: new Date(), mergeCommitSha: candidateSha } });
          if (!updated.count) throw new ConflictException({ error: { code: 'MERGE_METADATA_RECONCILING', message: 'Git đã merge; metadata đang được đối soát.' } });
          await tx.auditLog.create({ data: { actorId: userId, action: 'PULL_REQUEST_MERGED', targetId: pullRequest.id,
            details: { repositoryId: repo.id, number: pullRequest.number, operationId: dto.operationId, mergeCommitSha: candidateSha } } });
          await tx.pullRequestMergeOperation.update({ where: { operationId: dto.operationId },
            data: { status: 'COMPLETED', resultingSha: candidateSha, errorCode: null } });
        });
        return { status: 'MERGED', operationId: dto.operationId, mergeCommitSha: candidateSha };
      } catch {
        // Git refs are durable and cannot be safely rolled back after a database error.
        return { status: 'RECONCILING', operationId: dto.operationId };
      }
    } finally {
      await lock.release();
    }
  }
}

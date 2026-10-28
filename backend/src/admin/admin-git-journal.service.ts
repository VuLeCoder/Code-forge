import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GitStorageService } from '../repositories/git-storage.service';
import { RepositoryLockService } from '../repositories/repository-lock.service';
import { AdminGitJournalListQueryDto, AdminResolveGitJournalDto } from './admin.dto';

const UNRESOLVED = ['PENDING', 'NEEDS_RECONCILIATION'] as const;
type JournalType = 'PUSH' | 'MERGE';

@Injectable()
export class AdminGitJournalService {
  constructor(private readonly db: PrismaService, private readonly storage: GitStorageService,
    private readonly locks: RepositoryLockService) {}

  private page(value?: string) {
    if (value !== undefined && (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > 1000)) {
      throw new BadRequestException({ error: { code: 'INVALID_PAGE', message: 'Trang phải từ 1 đến 1000.' } });
    }
    return value === undefined ? 1 : Number(value);
  }

  private type(value: string): JournalType {
    if (value !== 'PUSH' && value !== 'MERGE') {
      throw new BadRequestException({ error: { code: 'INVALID_JOURNAL_TYPE', message: 'Loại journal không hợp lệ.' } });
    }
    return value;
  }

  async list(query: AdminGitJournalListQueryDto) {
    const page = this.page(query.page);
    const take = page * 20 + 1;
    const operationId = query.q && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.q)
      ? query.q : undefined;
    const repositoryFilter = query.q ? { OR: [
      { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
      { owner: { username: { contains: query.q, mode: Prisma.QueryMode.insensitive } } },
    ] } : undefined;
    const pushWhere: Prisma.GitPushOperationWhereInput = { status: { in: [...UNRESOLVED] },
      ...(query.q ? { OR: [...(operationId ? [{ operationId }] : []), { repository: repositoryFilter }] } : {}) };
    const mergeWhere: Prisma.PullRequestMergeOperationWhereInput = { status: { in: [...UNRESOLVED] },
      ...(query.q ? { OR: [...(operationId ? [{ operationId }] : []), { repository: repositoryFilter }] } : {}) };
    const includePush = !query.type || query.type === 'PUSH';
    const includeMerge = !query.type || query.type === 'MERGE';
    const [pushes, merges, pushCount, mergeCount] = await Promise.all([
      includePush ? this.db.gitPushOperation.findMany({ where: pushWhere, take, orderBy: [{ updatedAt: 'desc' }, { operationId: 'desc' }],
        select: { operationId: true, status: true, errorCode: true, storageGeneration: true, createdAt: true, updatedAt: true,
          actorId: true, repository: { select: { id: true, name: true,
            owner: { select: { id: true, username: true } } } } } }) : Promise.resolve([]),
      includeMerge ? this.db.pullRequestMergeOperation.findMany({ where: mergeWhere, take, orderBy: [{ updatedAt: 'desc' }, { operationId: 'desc' }],
        select: { operationId: true, status: true, errorCode: true, storageGeneration: true, createdAt: true, updatedAt: true,
          actorId: true, repository: { select: { id: true, name: true,
            owner: { select: { id: true, username: true } } } }, pullRequest: { select: { number: true } } } }) : Promise.resolve([]),
      includePush ? this.db.gitPushOperation.count({ where: pushWhere }) : Promise.resolve(0),
      includeMerge ? this.db.pullRequestMergeOperation.count({ where: mergeWhere }) : Promise.resolve(0),
    ]);
    const actorIds = [...new Set([...pushes, ...merges].map((item) => item.actorId))];
    const actors = await this.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true } });
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const rows = [
      ...pushes.map((item) => ({ type: 'PUSH' as const, ...item, actor: actorById.get(item.actorId) ?? null })),
      ...merges.map(({ pullRequest, ...item }) => ({ type: 'MERGE' as const, ...item,
        actor: actorById.get(item.actorId) ?? null, pullRequestNumber: pullRequest.number })),
    ].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
      || right.operationId.localeCompare(left.operationId));
    const start = (page - 1) * 20;
    return { journals: rows.slice(start, start + 20), page, pageSize: 20, total: pushCount + mergeCount,
      hasMore: rows.length > start + 20 };
  }

  async resolve(actorId: string, rawType: string, operationId: string, dto: AdminResolveGitJournalDto) {
    const type = this.type(rawType);
    const revision = new Date(dto.revision);
    const locator = type === 'PUSH'
      ? await this.db.gitPushOperation.findUnique({ where: { operationId }, select: { repositoryId: true } })
      : await this.db.pullRequestMergeOperation.findUnique({ where: { operationId }, select: { repositoryId: true } });
    if (!locator) throw new NotFoundException({ error: { code: 'GIT_JOURNAL_NOT_FOUND', message: 'Không tìm thấy Git journal.' } });
    const lock = await this.locks.acquire(locator.repositoryId);
    try {
      await this.assertActiveAdmin(actorId);
      return type === 'PUSH'
        ? await this.resolvePush(actorId, operationId, revision, dto.reasonCode)
        : await this.resolveMerge(actorId, operationId, revision, dto.reasonCode);
    } finally { await lock.release(); }
  }

  private async assertActiveAdmin(actorId: string) {
    const actor = await this.db.user.findUnique({ where: { id: actorId }, select: { systemRole: true, status: true } });
    if (!actor || actor.systemRole !== 'ADMIN' || actor.status !== 'ACTIVE') {
      throw new ForbiddenException({ error: { code: 'ADMIN_REQUIRED', message: 'Quyền admin không còn hiệu lực.' } });
    }
  }

  private stale(): never {
    throw new ConflictException({ error: { code: 'GIT_JOURNAL_CHANGED', message: 'Git journal đã thay đổi. Hãy tải lại trước khi đối soát.' } });
  }

  private unresolved(code: string, message: string): never {
    throw new ConflictException({ error: { code, message } });
  }

  private async assertEvidenceAvailable(operation: { storageGeneration: number; repository: { storageGeneration: number; storageKey: string } }) {
    if (operation.storageGeneration !== operation.repository.storageGeneration) {
      this.unresolved('STORAGE_GENERATION_CHANGED', 'Storage đã được thay thế; journal phải tiếp tục ở trạng thái chưa phân giải.');
    }
    if (!(await this.storage.exists(operation.repository.storageKey))) {
      this.unresolved('GIT_STORAGE_MISSING', 'Không còn storage để chứng minh kết quả Git.');
    }
  }

  private async resolvePush(actorId: string, operationId: string, revision: Date, reasonCode: string) {
    const operation = await this.db.gitPushOperation.findUnique({ where: { operationId }, include: { repository: true } });
    if (!operation) throw new NotFoundException({ error: { code: 'GIT_JOURNAL_NOT_FOUND', message: 'Không tìm thấy Git journal.' } });
    if (!UNRESOLVED.includes(operation.status as typeof UNRESOLVED[number])) {
      return { changed: false, journal: { type: 'PUSH', operationId, status: operation.status, revision: operation.updatedAt } };
    }
    if (operation.updatedAt.getTime() !== revision.getTime()) this.stale();
    const [otherPushes, merges] = await Promise.all([
      this.db.gitPushOperation.count({ where: { repositoryId: operation.repositoryId, operationId: { not: operationId }, status: { in: [...UNRESOLVED] } } }),
      this.db.pullRequestMergeOperation.count({ where: { repositoryId: operation.repositoryId, status: { in: [...UNRESOLVED] } } }),
    ]);
    if (otherPushes || merges) this.unresolved('COMPETING_GIT_JOURNAL', 'Có journal Git cạnh tranh nên chưa thể quy kết thay đổi refs.');
    await this.assertEvidenceAvailable(operation);
    let before: Record<string, string>;
    try { before = this.readSnapshot(operation.beforeRefs); }
    catch { this.unresolved('INVALID_GIT_EVIDENCE', 'Snapshot refs trong journal không hợp lệ.'); }
    const after = await this.storage.snapshotRefs(operation.repository.storageKey);
    const changedRefCount = this.changedRefCount(before!, after);
    if (changedRefCount > 0 && operation.errorCode !== 'GIT_CHILD_SUCCEEDED') {
      this.unresolved('GIT_OUTCOME_UNKNOWN', 'Refs đã thay đổi nhưng journal không chứng minh được tiến trình Git đã thành công.');
    }
    const outcome = changedRefCount === 0 ? 'FAILED' : 'COMPLETED';
    const resolutionCode = changedRefCount === 0 ? 'REFS_UNCHANGED' : 'CHILD_SUCCEEDED_REFS_CHANGED';
    const result = await this.db.$transaction(async (tx) => {
      const updated = await tx.gitPushOperation.updateMany({ where: { operationId, updatedAt: revision,
        status: { in: [...UNRESOLVED] }, storageGeneration: operation.storageGeneration }, data: {
        status: outcome, errorCode: outcome === 'FAILED' ? 'NO_REF_CHANGE' : null,
        changedRefCount: outcome === 'COMPLETED' ? changedRefCount : null, beforeRefs: Prisma.DbNull,
      } });
      if (!updated.count) return null;
      if (outcome === 'COMPLETED') await tx.auditLog.create({ data: { actorId: operation.actorId, action: 'GIT_PUSH_COMPLETED',
        targetId: operation.repositoryId, details: { operationId, repositoryId: operation.repositoryId,
          storageGeneration: operation.storageGeneration, changedRefCount } } });
      await this.auditResolution(tx, actorId, operation, 'PUSH', outcome, reasonCode, resolutionCode);
      return tx.gitPushOperation.findUniqueOrThrow({ where: { operationId }, select: { status: true, updatedAt: true } });
    });
    if (!result) this.stale();
    return { changed: true, journal: { type: 'PUSH', operationId, status: result.status, revision: result.updatedAt }, resolutionCode };
  }

  private async resolveMerge(actorId: string, operationId: string, revision: Date, reasonCode: string) {
    const operation = await this.db.pullRequestMergeOperation.findUnique({ where: { operationId },
      include: { repository: true, pullRequest: true } });
    if (!operation) throw new NotFoundException({ error: { code: 'GIT_JOURNAL_NOT_FOUND', message: 'Không tìm thấy Git journal.' } });
    if (!UNRESOLVED.includes(operation.status as typeof UNRESOLVED[number])) {
      return { changed: false, journal: { type: 'MERGE', operationId, status: operation.status, revision: operation.updatedAt } };
    }
    if (operation.updatedAt.getTime() !== revision.getTime()) this.stale();
    const [pushes, otherMerges] = await Promise.all([
      this.db.gitPushOperation.count({ where: { repositoryId: operation.repositoryId, status: { in: [...UNRESOLVED] } } }),
      this.db.pullRequestMergeOperation.count({ where: { repositoryId: operation.repositoryId, operationId: { not: operationId }, status: { in: [...UNRESOLVED] } } }),
    ]);
    if (pushes || otherMerges) this.unresolved('COMPETING_GIT_JOURNAL', 'Có journal Git cạnh tranh nên chưa thể quy kết thay đổi refs.');
    await this.assertEvidenceAvailable(operation);
    const actualTarget = await this.storage.branchSha(operation.repository.storageKey, operation.pullRequest.targetBranch);
    let outcome: 'FAILED' | 'COMPLETED';
    let resolutionCode: string;
    if (actualTarget === operation.oldTargetSha) {
      outcome = 'FAILED'; resolutionCode = 'TARGET_REF_UNCHANGED';
    } else {
      if (!operation.candidateSha || !actualTarget
        || !(await this.storage.isAncestor(operation.repository.storageKey, operation.candidateSha, actualTarget))) {
        this.unresolved('GIT_OUTCOME_UNKNOWN', 'Target ref không cung cấp đủ bằng chứng cho merge candidate.');
      }
      const candidate = await this.storage.commit(operation.repository.storageKey, operation.candidateSha);
      if (candidate.parentShas.length !== 2 || candidate.parentShas[0] !== operation.oldTargetSha
        || candidate.parentShas[1] !== operation.expectedSourceSha) {
        this.unresolved('MERGE_CANDIDATE_MISMATCH', 'Merge candidate không có đúng hai parent đã ghi trong journal.');
      }
      outcome = 'COMPLETED'; resolutionCode = 'TWO_PARENT_CANDIDATE_REACHABLE';
    }
    const result = await this.db.$transaction(async (tx) => {
      const updated = await tx.pullRequestMergeOperation.updateMany({ where: { operationId, updatedAt: revision,
        status: { in: [...UNRESOLVED] }, storageGeneration: operation.storageGeneration }, data: outcome === 'COMPLETED'
        ? { status: 'COMPLETED', resultingSha: operation.candidateSha, errorCode: null }
        : { status: 'FAILED', errorCode: 'REF_NOT_UPDATED' } });
      if (!updated.count) return null;
      if (outcome === 'COMPLETED') {
        await tx.pullRequest.updateMany({ where: { id: operation.pullRequestId, status: { not: 'MERGED' } },
          data: { status: 'MERGED', version: { increment: 1 }, mergedById: operation.actorId,
            mergedAt: new Date(), mergeCommitSha: operation.candidateSha } });
        await tx.auditLog.create({ data: { actorId: operation.actorId, action: 'PULL_REQUEST_MERGE_RECONCILED',
          targetId: operation.pullRequestId, details: { repositoryId: operation.repositoryId,
            number: operation.pullRequest.number, operationId, mergeCommitSha: operation.candidateSha } } });
      }
      await this.auditResolution(tx, actorId, operation, 'MERGE', outcome, reasonCode, resolutionCode);
      return tx.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId }, select: { status: true, updatedAt: true } });
    });
    if (!result) this.stale();
    return { changed: true, journal: { type: 'MERGE', operationId, status: result.status, revision: result.updatedAt }, resolutionCode };
  }

  private async auditResolution(tx: Prisma.TransactionClient, actorId: string,
    operation: { operationId: string; repositoryId: string; actorId: string; storageGeneration: number },
    operationType: JournalType, outcome: string, reasonCode: string, resolutionCode: string) {
    await tx.auditLog.create({ data: { actorId, action: 'ADMIN_GIT_JOURNAL_RESOLVED', targetId: operation.repositoryId,
      details: { repositoryId: operation.repositoryId, operationId: operation.operationId, operationType, outcome,
        reasonCode, resolutionCode, originalActorId: operation.actorId, storageGeneration: operation.storageGeneration } } });
  }

  private readSnapshot(value: Prisma.JsonValue): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid snapshot');
    const refs = Object.create(null) as Record<string, string>;
    for (const [ref, sha] of Object.entries(value)) {
      if (!ref.startsWith('refs/heads/') || typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
        throw new Error('Invalid snapshot');
      }
      this.storage.validateRef(ref.slice('refs/heads/'.length));
      refs[ref] = sha;
    }
    return refs;
  }

  private changedRefCount(before: Record<string, string>, after: Record<string, string>) {
    const refs = new Set([...Object.keys(before), ...Object.keys(after)]);
    let changed = 0;
    for (const ref of refs) if (before[ref] !== after[ref]) changed++;
    return changed;
  }
}

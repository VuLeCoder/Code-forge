import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RepositoryStatus, type UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AdminListQueryDto } from './admin.dto';
import { RepositoryLockService } from '../repositories/repository-lock.service';
import { GitPushJournalService } from '../repositories/git-push-journal.service';

const DETAIL_KEYS = new Set(['repositoryId', 'number', 'operationId', 'mergeCommitSha', 'changedRefCount', 'storageGeneration', 'from', 'to', 'invitationId', 'memberId', 'role', 'channel']);

@Injectable()
export class AdminService {
  constructor(private readonly db: PrismaService, private readonly locks: RepositoryLockService,
    private readonly pushJournal: GitPushJournalService) {}

  private page(value?: string) {
    if (value !== undefined && (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > 1000)) {
      throw new BadRequestException({ error: { code: 'INVALID_PAGE', message: 'Trang phải từ 1 đến 1000.' } });
    }
    return value === undefined ? 1 : Number(value);
  }

  private async audit(tx: Prisma.TransactionClient, actorId: string, action: string, targetId: string, details: Record<string, string | number | null>) {
    await tx.auditLog.create({ data: { actorId, action, targetId, details } });
  }

  async stats() {
    const [users, activeUsers, lockedUsers, repositories, activeRepositories, lockedRepositories, deletedRepositories, pullRequests, openPullRequests, pendingMerges] = await Promise.all([
      this.db.user.count(), this.db.user.count({ where: { status: 'ACTIVE' } }), this.db.user.count({ where: { status: 'LOCKED' } }),
      this.db.repository.count(), this.db.repository.count({ where: { status: 'ACTIVE' } }), this.db.repository.count({ where: { status: 'LOCKED' } }),
      this.db.repository.count({ where: { status: 'DELETED' } }), this.db.pullRequest.count(), this.db.pullRequest.count({ where: { status: 'OPEN' } }),
      this.db.pullRequestMergeOperation.count({ where: { status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } } }),
    ]);
    return { users: { total: users, active: activeUsers, locked: lockedUsers },
      repositories: { total: repositories, active: activeRepositories, locked: lockedRepositories, deleted: deletedRepositories },
      pullRequests: { total: pullRequests, open: openPullRequests, pendingMerges } };
  }

  async listUsers(query: AdminListQueryDto) {
    const page = this.page(query.page);
    if (query.status !== undefined && !['ACTIVE', 'LOCKED'].includes(query.status)) {
      throw new BadRequestException({ error: { code: 'INVALID_USER_STATUS', message: 'Trạng thái user không hợp lệ.', details: {} } });
    }
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status as UserStatus } : {}),
      ...(query.q ? { OR: [{ username: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([this.db.user.findMany({ where, select: { id: true, username: true, email: true,
      systemRole: true, status: true, lockedAt: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }),
      this.db.user.count({ where })]);
    return { users: rows.slice(0, 20), page, pageSize: 20, total, hasMore: rows.length > 20 };
  }

  async listRepositories(query: AdminListQueryDto) {
    const page = this.page(query.page);
    if (query.status !== undefined && !['ACTIVE', 'LOCKED', 'DELETED'].includes(query.status)) {
      throw new BadRequestException({ error: { code: 'INVALID_REPOSITORY_STATUS', message: 'Trạng thái repository không hợp lệ.', details: {} } });
    }
    const where: Prisma.RepositoryWhereInput = {
      ...(query.status ? { status: query.status as RepositoryStatus } : {}),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } },
        { owner: { username: { contains: query.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([this.db.repository.findMany({ where,
      select: { id: true, name: true, description: true, visibility: true, status: true, defaultBranch: true,
        storageGeneration: true, createdAt: true, updatedAt: true, deletedAt: true, purgeAfter: true,
        owner: { select: { id: true, username: true } }, _count: { select: { pullRequests: true, members: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }), this.db.repository.count({ where })]);
    return { repositories: rows.slice(0, 20), page, pageSize: 20, total, hasMore: rows.length > 20 };
  }

  async listAudit(query: AdminListQueryDto) {
    const page = this.page(query.page);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.q ? { OR: [{ action: { contains: query.q, mode: 'insensitive' } }, { targetId: query.q }] } : {}),
    };
    const [rows, total] = await Promise.all([this.db.auditLog.findMany({ where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }), this.db.auditLog.count({ where })]);
    const selected = rows.slice(0, 20);
    const actorIds = [...new Set(selected.flatMap((row) => row.actorId ? [row.actorId] : []))];
    const actors = await this.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true } });
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const audit = selected.map((row) => ({ ...row, actor: row.actorId ? actorById.get(row.actorId) ?? null : null, details: this.safeDetails(row.details) }));
    return { audit, page, pageSize: 20, total, hasMore: rows.length > 20 };
  }

  private safeDetails(value: Prisma.JsonValue): Record<string, string | number | boolean | null> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const safe: Record<string, string | number | boolean | null> = {};
    for (const [key, item] of Object.entries(value)) {
      if (DETAIL_KEYS.has(key) && (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) safe[key] = item;
    }
    return safe;
  }

  async setUserStatus(actorId: string, userId: string, status: UserStatus) {
    if (actorId === userId && status === 'LOCKED') throw new ConflictException({ error: { code: 'CANNOT_LOCK_SELF', message: 'Admin không thể tự khóa tài khoản của mình.' } });
    return this.db.$transaction(async (tx) => {
      // Lock all active admins in a stable order so concurrent requests cannot lock the final one.
      const activeAdmins = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE system_role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
      // Session creation and rotation take the target user lock before writing sessions.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new NotFoundException({ error: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy user.' } });
      if (status === 'LOCKED' && target.systemRole === 'ADMIN' && target.status === 'ACTIVE' && activeAdmins.length <= 1) {
        throw new ConflictException({ error: { code: 'LAST_ACTIVE_ADMIN', message: 'Không thể khóa admin đang hoạt động cuối cùng.' } });
      }
      if (target.status === status) return { user: { id: target.id, status: target.status, lockedAt: target.lockedAt }, changed: false };
      const lockedAt = status === 'LOCKED' ? new Date() : null;
      const updated = await tx.user.update({ where: { id: userId }, data: { status, lockedAt },
        select: { id: true, username: true, status: true, systemRole: true, lockedAt: true } });
      if (status === 'LOCKED') await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actorId, status === 'LOCKED' ? 'ADMIN_USER_LOCKED' : 'ADMIN_USER_UNLOCKED', userId, { from: target.status, to: status });
      return { user: updated, changed: true };
    });
  }

  async setRepositoryStatus(actorId: string, repositoryId: string, status: 'ACTIVE' | 'LOCKED') {
    const lock = await this.locks.acquire(repositoryId);
    try { await this.pushJournal.assertNoUnresolved(repositoryId); return await this.db.$transaction(async (tx) => {
      const target = await tx.repository.findUnique({ where: { id: repositoryId } });
      if (!target) throw new NotFoundException({ error: { code: 'REPOSITORY_NOT_FOUND', message: 'Không tìm thấy repository.' } });
      if (target.status === 'DELETED') throw new ConflictException({ error: { code: 'REPOSITORY_DELETED', message: 'Hãy dùng thao tác khôi phục cho repository đã xóa.' } });
      if (target.status === status) return { repository: { id: target.id, status }, changed: false };
      const updated = await tx.repository.update({ where: { id: repositoryId }, data: { status }, select: { id: true, status: true } });
      await this.audit(tx, actorId, status === 'LOCKED' ? 'ADMIN_REPOSITORY_LOCKED' : 'ADMIN_REPOSITORY_UNLOCKED', repositoryId, { from: target.status, to: status });
      return { repository: updated, changed: true };
    }); } finally { await lock.release(); }
  }

  async restoreRepository(actorId: string, repositoryId: string) {
    const lock = await this.locks.acquire(repositoryId);
    try { await this.pushJournal.assertNoUnresolved(repositoryId); return await this.db.$transaction(async (tx) => {
      const target = await tx.repository.findUnique({ where: { id: repositoryId } });
      if (!target) throw new NotFoundException({ error: { code: 'REPOSITORY_NOT_FOUND', message: 'Không tìm thấy repository.' } });
      if (target.status !== 'DELETED') throw new ConflictException({ error: { code: 'REPOSITORY_NOT_DELETED', message: 'Repository hiện không ở trạng thái đã xóa.' } });
      if (!target.purgeAfter || target.purgeAfter <= new Date()) throw new ConflictException({ error: { code: 'RESTORE_EXPIRED', message: 'Đã hết thời hạn khôi phục repository.' } });
      const updated = await tx.repository.update({ where: { id: repositoryId }, data: { status: 'ACTIVE', deletedAt: null, purgeAfter: null }, select: { id: true, status: true } });
      await this.audit(tx, actorId, 'ADMIN_REPOSITORY_RESTORED', repositoryId, { from: 'DELETED', to: 'ACTIVE' });
      return { repository: updated, sourceMayBeReset: true };
    }); } finally { await lock.release(); }
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RepositoryLockService } from '../repositories/repository-lock.service';
import { GitPushJournalService } from '../repositories/git-push-journal.service';

@Injectable()
export class InvitationsService {
  constructor(private readonly db: PrismaService, private readonly locks: RepositoryLockService,
    private readonly pushJournal: GitPushJournalService) {}

  private async lock(tx: Prisma.TransactionClient, userId: string, id: string) {
    const users = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (users[0]?.status !== 'ACTIVE') throw new ForbiddenException();
    // Match owner/member mutation order: user -> repository -> invitation.
    await tx.$queryRaw`SELECT r.id FROM repositories r JOIN invitations i ON i.repository_id = r.id
      WHERE i.id = ${id}::uuid AND i.invitee_id = ${userId}::uuid FOR UPDATE OF r`;
    await tx.$queryRaw`SELECT id FROM invitations WHERE id = ${id}::uuid AND invitee_id = ${userId}::uuid FOR UPDATE`;
  }

  async list(userId: string) {
    const rows = await this.db.invitation.findMany({
      where: {
        inviteeId: userId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        repository: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        repository: {
          select: {
            id: true,
            name: true,
            owner: { select: { username: true } },
          },
        },
        inviter: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      invitations: rows.map((inv) => ({
        id: inv.id,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        repository: {
          id: inv.repository.id,
          name: inv.repository.name,
          owner: { username: inv.repository.owner.username },
        },
        inviter: {
          id: inv.inviter.id,
          username: inv.inviter.username,
        },
      })),
    };
  }

  async accept(userId: string, id: string) {
    const initial = await this.db.invitation.findFirst({ where: { id, inviteeId: userId }, select: { repositoryId: true } });
    if (!initial) throw new NotFoundException({ error: { code: 'INVITATION_NOT_FOUND', message: 'Không tìm thấy lời mời.' } });
    const repositoryLock = await this.locks.acquire(initial.repositoryId);
    try {
    await this.pushJournal.assertNoUnresolved(initial.repositoryId);
    const result = await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      const invitation = await tx.invitation.findFirst({
        where: { id, inviteeId: userId },
        include: { repository: true },
      });

      if (!invitation) {
        throw new NotFoundException({ error: { code: 'INVITATION_NOT_FOUND', message: 'Không tìm thấy lời mời.' } });
      }

      if (invitation.status !== 'PENDING') {
        throw new ConflictException({ error: { code: 'INVITATION_NOT_PENDING', message: 'Lời mời không còn ở trạng thái chờ.' } });
      }

      if (invitation.expiresAt <= new Date()) {
        await tx.invitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        return { expired: true as const };
      }

      if (invitation.repository.ownerId === userId) {
        throw new BadRequestException({ error: { code: 'CANNOT_ACCEPT_OWN_REPO', message: 'Chủ sở hữu repository không thể làm thành viên cộng tác.' } });
      }

      if (invitation.repository.status !== 'ACTIVE' || invitation.repository.deletedAt !== null) {
        throw new ConflictException({ error: { code: 'REPOSITORY_UNAVAILABLE', message: 'Repository không còn khả dụng.' } });
      }

      const updated = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED' },
      });
      if (updated.count === 0) {
        throw new ConflictException({ error: { code: 'INVITATION_NOT_PENDING', message: 'Lời mời không còn ở trạng thái chờ.' } });
      }

      await tx.repositoryMember.upsert({
        where: { repositoryId_userId: { repositoryId: invitation.repositoryId, userId } },
        create: { repositoryId: invitation.repositoryId, userId, role: invitation.role },
        update: { role: invitation.role },
      });

      await tx.auditLog.create({
        data: { actorId: userId, action: 'INVITATION_ACCEPTED', targetId: invitation.id },
      });

      return {
        success: true,
        repositoryId: invitation.repositoryId,
        role: invitation.role,
      };
    });
    // Throw outside the transaction, so EXPIRED is not rolled back.
    if ('expired' in result) throw new ConflictException({ error: { code: 'INVITATION_EXPIRED', message: 'Lời mời đã hết hạn.' } });
    return result;
    } finally { await repositoryLock.release(); }
  }

  async decline(userId: string, id: string) {
    const initial = await this.db.invitation.findFirst({ where: { id, inviteeId: userId }, select: { repositoryId: true } });
    if (!initial) throw new NotFoundException({ error: { code: 'INVITATION_NOT_FOUND', message: 'Không tìm thấy lời mời.' } });
    const repositoryLock = await this.locks.acquire(initial.repositoryId);
    try {
    await this.pushJournal.assertNoUnresolved(initial.repositoryId);
    const result = await this.db.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      const invitation = await tx.invitation.findFirst({
        where: { id, inviteeId: userId },
      });

      if (!invitation) {
        throw new NotFoundException({ error: { code: 'INVITATION_NOT_FOUND', message: 'Không tìm thấy lời mời.' } });
      }

      if (invitation.status !== 'PENDING') {
        throw new ConflictException({ error: { code: 'INVITATION_NOT_PENDING', message: 'Lời mời không còn ở trạng thái chờ.' } });
      }

      if (invitation.expiresAt <= new Date()) {
        await tx.invitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
        return { expired: true as const };
      }

      const updated = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'DECLINED' },
      });
      if (updated.count === 0) {
        throw new ConflictException({ error: { code: 'INVITATION_NOT_PENDING', message: 'Lời mời không còn ở trạng thái chờ.' } });
      }

      await tx.auditLog.create({
        data: { actorId: userId, action: 'INVITATION_DECLINED', targetId: invitation.id },
      });

      return {
        success: true,
      };
    });
    if ('expired' in result) throw new ConflictException({ error: { code: 'INVITATION_EXPIRED', message: 'Lời mời đã hết hạn.' } });
    return result;
    } finally { await repositoryLock.release(); }
  }
}

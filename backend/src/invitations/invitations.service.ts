import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class InvitationsService {
  constructor(private readonly db: PrismaService) {}

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
    return this.db.$transaction(async (tx) => {
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
        throw new ConflictException({ error: { code: 'INVITATION_EXPIRED', message: 'Lời mời đã hết hạn.' } });
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
  }

  async decline(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id, inviteeId: userId },
      });

      if (!invitation) {
        throw new NotFoundException({ error: { code: 'INVITATION_NOT_FOUND', message: 'Không tìm thấy lời mời.' } });
      }

      if (invitation.status !== 'PENDING') {
        throw new ConflictException({ error: { code: 'INVITATION_NOT_PENDING', message: 'Lời mời không còn ở trạng thái chờ.' } });
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
  }
}

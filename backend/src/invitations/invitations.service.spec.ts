import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import { InvitationsService } from './invitations.service';
import { RepositoryLockService } from '../repositories/repository-lock.service';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let db: {
    invitation: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    repositoryMember: {
      upsert: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  const locks = { acquire: jest.fn(() => Promise.resolve({ signal: new AbortController().signal, release: jest.fn() })) };

  const userId = '11111111-1111-1111-1111-111111111111';
  const invitationId = '22222222-2222-2222-2222-222222222222';
  const repoId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    db = {
      invitation: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repositoryMember: {
        upsert: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db)),
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
    };
    locks.acquire.mockClear();
    service = new InvitationsService(db as unknown as PrismaService, locks as unknown as RepositoryLockService,
      { assertNoUnresolved: jest.fn().mockResolvedValue(undefined) } as never);
  });

  describe('list', () => {
    it('returns pending invitations for the user', async () => {
      const mockInvitations = [
        {
          id: invitationId,
          role: 'WRITE',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          repository: { id: repoId, name: 'repo-one', owner: { username: 'alice' } },
          inviter: { id: '44444444-4444-4444-4444-444444444444', username: 'alice' },
        },
      ];
      db.invitation.findMany.mockResolvedValue(mockInvitations);

      const result = await service.list(userId);
      expect(result.invitations).toHaveLength(1);
      expect(result.invitations[0]).toMatchObject({
        id: invitationId,
        role: 'WRITE',
        status: 'PENDING',
        repository: { name: 'repo-one', owner: { username: 'alice' } },
        inviter: { username: 'alice' },
      });
      expect(db.invitation.findMany).toHaveBeenCalledTimes(1);
      const callArg = db.invitation.findMany.mock.calls[0] as [{ where: { inviteeId: string; status: string } }];
      expect(callArg[0].where.inviteeId).toBe(userId);
      expect(callArg[0].where.status).toBe('PENDING');
    });
  });

  describe('accept', () => {
    it('throws NotFoundException when invitation does not exist', async () => {
      db.invitation.findFirst.mockResolvedValue(null);

      await expect(service.accept(userId, invitationId)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when invitation is not PENDING', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        inviteeId: userId,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 86400000),
        repository: { status: 'ACTIVE', deletedAt: null },
      });

      await expect(service.accept(userId, invitationId)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when invitation has expired', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        inviteeId: userId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
        repository: { status: 'ACTIVE', deletedAt: null },
      });

      await expect(service.accept(userId, invitationId)).rejects.toThrow(ConflictException);
      expect(db.invitation.updateMany).toHaveBeenCalledWith({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    });

    it('throws ConflictException when repository is inactive or deleted', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        inviteeId: userId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000),
        repository: { status: 'DELETED', deletedAt: new Date() },
      });

      await expect(service.accept(userId, invitationId)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when concurrent accept CAS fails', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        repositoryId: repoId,
        inviteeId: userId,
        role: 'WRITE',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000),
        repository: { ownerId: 'other-user', status: 'ACTIVE', deletedAt: null },
      });
      db.invitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept(userId, invitationId)).rejects.toThrow(ConflictException);
    });

    it('accepts successfully, upserts membership, and creates audit log', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        repositoryId: repoId,
        inviteeId: userId,
        role: 'WRITE',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000),
        repository: { ownerId: 'other-user', status: 'ACTIVE', deletedAt: null },
      });

      const result = await service.accept(userId, invitationId);
      expect(result).toEqual({ success: true, repositoryId: repoId, role: 'WRITE' });

      expect(db.invitation.updateMany).toHaveBeenCalledWith({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'ACCEPTED' },
      });
      expect(db.repositoryMember.upsert).toHaveBeenCalledWith({
        where: { repositoryId_userId: { repositoryId: repoId, userId } },
        create: { repositoryId: repoId, userId, role: 'WRITE' },
        update: { role: 'WRITE' },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: userId, action: 'INVITATION_ACCEPTED', targetId: invitationId },
      });
    });
  });

  describe('decline', () => {
    it('throws NotFoundException when invitation does not exist', async () => {
      db.invitation.findFirst.mockResolvedValue(null);

      await expect(service.decline(userId, invitationId)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when invitation is not PENDING', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        inviteeId: userId,
        status: 'REVOKED',
      });

      await expect(service.decline(userId, invitationId)).rejects.toThrow(ConflictException);
    });

    it('marks an expired pending invitation EXPIRED before rejecting and releases the repository lock', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        inviteeId: userId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      });
      const release = jest.fn();
      locks.acquire.mockResolvedValue({ signal: new AbortController().signal, release });
      let transactionResult: unknown;
      db.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        transactionResult = await callback(db);
        return transactionResult;
      });

      await expect(service.decline(userId, invitationId)).rejects.toMatchObject({
        response: { error: { code: 'INVITATION_EXPIRED' } },
      });

      expect(transactionResult).toEqual({ expired: true });
      expect(db.invitation.updateMany).toHaveBeenCalledWith({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      expect(db.invitation.updateMany).toHaveBeenCalledTimes(1);
      expect(db.auditLog.create).not.toHaveBeenCalled();
      expect(db.repositoryMember.upsert).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('declines successfully and creates audit log', async () => {
      db.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        inviteeId: userId,
        status: 'PENDING',
      });

      const result = await service.decline(userId, invitationId);
      expect(result).toEqual({ success: true });

      expect(db.invitation.updateMany).toHaveBeenCalledWith({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'DECLINED' },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: userId, action: 'INVITATION_DECLINED', targetId: invitationId },
      });
    });
  });
});

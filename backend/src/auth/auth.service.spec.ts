import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Prisma, type Session, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import type { PrismaService } from '../database/prisma.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

const now = new Date('2026-09-12T00:00:00.000Z');
const user: User = {
  id: '32f274d7-985d-4619-8990-9a240dbbe1d0',
  username: 'alice',
  normalizedUsername: 'alice',
  email: 'alice@example.com',
  normalizedEmail: 'alice@example.com',
  passwordHash: '',
  systemRole: 'USER',
  status: 'ACTIVE',
  lockedAt: null,
  passwordChangedAt: now,
  createdAt: now,
  updatedAt: now,
};
const session: Session = {
  id: '2ea16e26-3cb9-4cd1-8f2a-11a940c49064',
  userId: user.id,
  familyId: 'b113b534-a644-4cf7-ac67-6071441d7a84',
  tokenHash: 'hash',
  expiresAt: new Date(Date.now() + 86_400_000),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
};

describe('AuthService', () => {
  const findByLogin = jest.fn();
  const transaction = jest.fn();
  const createSession = jest.fn<Promise<Session>, [unknown]>();
  const updateSessions = jest.fn<Promise<{ count: number }>, [unknown]>();
  const sessionApi = {
    create: createSession,
    findUnique: jest.fn(),
    updateMany: updateSessions,
  };
  const prisma = {
    session: sessionApi,
    $transaction: transaction,
  } as unknown as PrismaService;
  const users = {
    findByLogin,
  } as unknown as UsersService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') } as unknown as JwtService;
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        JWT_ACCESS_SECRET: 'test-secret-that-is-longer-than-32-characters',
        ACCESS_TOKEN_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_DAYS: 30,
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma, users, jwt, config);
  });

  it('rejects invalid credentials without creating a session', async () => {
    findByLogin.mockResolvedValue(null);
    await expect(service.login({ login: 'nobody', password: 'wrong-password' })).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(sessionApi.create).not.toHaveBeenCalled();
  });

  it.each(['normalizedUsername', 'normalizedEmail'])('maps duplicate %s to a conflict without creating a session', async (field) => {
    transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002', clientVersion: '6.19.3', meta: { target: [field] },
    }));
    await expect(service.register({ username: 'Alice', email: 'alice@example.test', password: 'correct-password' }))
      .rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(sessionApi.create).not.toHaveBeenCalled();
  });

  it('rejects a locked account even when the password is correct', async () => {
    const passwordHash = await argon2.hash('correct-password');
    findByLogin.mockResolvedValue({ ...user, passwordHash, status: 'LOCKED' });
    await expect(service.login({ login: 'alice', password: 'correct-password' })).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('rotates a valid refresh token and keeps its token family', async () => {
    sessionApi.findUnique.mockResolvedValue({ ...session, user });
    sessionApi.updateMany.mockResolvedValue({ count: 1 });
    const transactionSession = {
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>().mockResolvedValue({ count: 1 }),
      create: jest.fn<Promise<Session>, [unknown]>(),
    };
    transactionSession.create.mockResolvedValue({ ...session, id: 'new-session' });
    transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      callback({ session: transactionSession } as never),
    );

    const result = await service.refresh('valid-refresh-token');

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).not.toBe('valid-refresh-token');
    const createInput = transactionSession.create.mock.calls[0]?.[0] as
      | { data: { familyId: string; userId: string } }
      | undefined;
    expect(createInput?.data.familyId).toBe(session.familyId);
    expect(createInput?.data.userId).toBe(user.id);
  });

  it('revokes the active token family when a rotated token is reused', async () => {
    sessionApi.findUnique.mockResolvedValue({ ...session, user, revokedAt: now });
    sessionApi.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.refresh('reused-token')).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    const revokeInput = sessionApi.updateMany.mock.calls[0]?.[0] as
      | { where: { familyId: string; revokedAt: null }; data: { revokedAt: Date } }
      | undefined;
    expect(revokeInput?.where).toEqual({ familyId: session.familyId, revokedAt: null });
    expect(revokeInput?.data.revokedAt).toBeInstanceOf(Date);
  });

  it('makes logout idempotent when no refresh cookie exists', async () => {
    await service.logout(undefined);
    expect(sessionApi.updateMany).not.toHaveBeenCalled();
  });
});

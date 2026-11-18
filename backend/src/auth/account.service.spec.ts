import { AuthService } from './auth.service';
import type { PrismaService } from '../database/prisma.service';
import type { UsersService } from '../users/users.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

describe('account settings', () => {
  const user = { id: 'user', username: 'alice', email: 'alice@example.com', status: 'ACTIVE', avatarUrl: null, passwordHash: '', createdAt: new Date() };
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn<Promise<unknown>, [{ where: { id: string }; data: Record<string, unknown> }]>() },
    session: { findFirst: jest.fn(), updateMany: jest.fn() },
    personalAccessToken: { updateMany: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
  const service = new AuthService(prisma as unknown as PrismaService, {} as UsersService, {} as JwtService, {} as ConfigService);

  beforeAll(async () => { user.passwordHash = await argon2.hash('Current123'); });
  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findUnique.mockResolvedValue(user);
    tx.session.findFirst.mockResolvedValue({ id: 'session' });
    tx.user.update.mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...user, ...data }));
  });

  it('requires the current password for email and username changes', async () => {
    await expect(service.updateAccount('user', 'session', { email: 'new@example.com', currentPassword: 'wrong' })).rejects.toMatchObject({ response: { error: { code: 'CURRENT_PASSWORD_INVALID' } } });
    await expect(service.updateAccount('user', 'session', { username: 'bob' })).rejects.toMatchObject({ response: { error: { code: 'CURRENT_PASSWORD_INVALID' } } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('normalizes changed identifiers without exposing a password hash', async () => {
    const result = await service.updateAccount('user', 'session', { username: 'Alice-New', email: 'New@Example.com', currentPassword: 'Current123' });
    const call = tx.user.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ normalizedUsername: 'alice-new', normalizedEmail: 'new@example.com' });
    expect(result.username).toBe('Alice-New');
    expect(result).not.toHaveProperty('passwordHash');
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });

  it('hashes new passwords and revokes other sessions and access tokens', async () => {
    await service.updateAccount('user', 'session', { currentPassword: 'Current123', newPassword: 'Changed456' });
    const passwordHash = tx.user.update.mock.calls[0]![0].data.passwordHash;
    expect(typeof passwordHash).toBe('string');
    if (typeof passwordHash !== 'string') throw new Error('Expected a password hash');
    expect(await argon2.verify(passwordHash, 'Changed456')).toBe(true);
    expect(tx.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user', id: { not: 'session' }, revokedAt: null } }));
    expect(tx.personalAccessToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user', revokedAt: null } }));
  });

  it('rejects a revoked session even after the request guard has run', async () => {
    tx.session.findFirst.mockResolvedValue(null);
    await expect(service.updateAccount('user', 'session', { avatarUrl: '' })).rejects.toMatchObject({ response: { error: { code: 'AUTH_REQUIRED' } } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects reserved names and non-image avatar content', async () => {
    await expect(service.updateAccount('user', 'session', { username: 'settings' })).rejects.toMatchObject({ response: { error: { code: 'USERNAME_RESERVED' } } });
    await expect(service.updateAccount('user', 'session', { avatarUrl: 'data:image/jpeg;base64,aGVsbG8=' })).rejects.toMatchObject({ response: { error: { code: 'INVALID_AVATAR' } } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows removing the avatar without password changes', async () => {
    const result = await service.updateAccount('user', 'session', { avatarUrl: '' });
    expect(result.avatarUrl).toBeNull();
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user' }, data: { avatarUrl: null } });
  });

  it('maps duplicate email or username to a conflict', async () => {
    tx.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' }));
    await expect(service.updateAccount('user', 'session', { username: 'bob', currentPassword: 'Current123' })).rejects.toMatchObject({ response: { error: { code: 'ACCOUNT_ALREADY_EXISTS' } } });
  });
});

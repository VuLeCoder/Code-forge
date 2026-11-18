import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RepositoriesService } from './repositories.service';
import { RepositoryPolicy } from './repository.policy';
import { UpdateMemberRoleDto, UpdateRepositoryDto } from './repository.dto';

describe('Repository settings authorization and validation', () => {
  function fixture() {
    const repository = { id: 'repo', ownerId: 'owner', name: 'project', defaultBranch: 'main', protectDefaultBranch: true,
      owner: { username: 'alice' }, status: 'ACTIVE', deletedAt: null, visibility: 'PUBLIC', storageKey: 'storage', members: [] };
    const member = { userId: 'writer', role: 'WRITE', canMerge: true, user: { id: 'writer', username: 'bob' } };
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      repository: { findFirst: jest.fn().mockResolvedValue(repository), update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...repository, ...data })) },
      repositoryMember: { findUnique: jest.fn().mockResolvedValue(member), update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...member, ...data })) },
      auditLog: { create: jest.fn() } };
    const db = { ...tx, $transaction: jest.fn((callback: (t: typeof tx) => unknown) => callback(tx)) };
    const release = jest.fn();
    const storage = { branches: jest.fn().mockResolvedValue({ branches: [{ name: 'main' }, { name: 'develop' }] }) };
    const service = new RepositoriesService(db as never, { getOrThrow: () => 'http://localhost' } as never,
      new RepositoryPolicy(), storage as never, {} as never, { acquire: jest.fn().mockResolvedValue({ release }) } as never,
      { assertNoUnresolved: jest.fn() } as never);
    return { service, tx, repository, member, storage, release };
  }

  it('only allows the owner to change branch protection', async () => {
    const { service, tx } = fixture();
    await expect(service.update('alice', 'project', 'writer', { protectDefaultBranch: false })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.repository.update).not.toHaveBeenCalled();
  });

  it('saves protection independently without changing the default branch', async () => {
    const { service, tx } = fixture();
    await service.update('alice', 'project', 'owner', { protectDefaultBranch: false });
    expect((tx.repository.update.mock.calls as unknown[][])[0]?.[0]).toMatchObject({ data: { protectDefaultBranch: false, defaultBranch: undefined } });
  });

  it('allows changing to an existing branch but rejects a missing branch before SQL mutation', async () => {
    const { service, tx } = fixture();
    await expect(service.update('alice', 'project', 'owner', { defaultBranch: 'missing' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.repository.update).not.toHaveBeenCalled();
    await service.update('alice', 'project', 'owner', { defaultBranch: 'develop' });
    expect((tx.repository.update.mock.calls as unknown[][])[0]?.[0]).toMatchObject({ data: { defaultBranch: 'develop' } });
  });

  it('requires WRITE permission for a merge grant and prevents modifying the owner', async () => {
    const { service, member, tx } = fixture();
    member.role = 'READ';
    await expect(service.updateMemberRole('alice', 'project', 'owner', 'writer', { canMerge: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMemberRole('alice', 'project', 'owner', 'owner', { canMerge: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.repositoryMember.update).not.toHaveBeenCalled();
  });

  it('revokes merge permission when a member is downgraded to READ', async () => {
    const { service, tx } = fixture();
    await service.updateMemberRole('alice', 'project', 'owner', 'writer', { role: 'READ' });
    expect(tx.repositoryMember.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'READ', canMerge: false } }));
  });

  it('accepts an independent merge grant or revocation without requiring a role update', async () => {
    const { service, tx } = fixture();
    await service.updateMemberRole('alice', 'project', 'owner', 'writer', { canMerge: true });
    await service.updateMemberRole('alice', 'project', 'owner', 'writer', { canMerge: false });
    expect(tx.repositoryMember.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { role: undefined, canMerge: false } }));
  });

  it('validates explicit booleans and rejects null, strings, and empty branches', async () => {
    for (const value of [null, 'false', 0]) {
      expect((await validate(plainToInstance(UpdateRepositoryDto, { protectDefaultBranch: value }))).length).toBeGreaterThan(0);
      expect((await validate(plainToInstance(UpdateMemberRoleDto, { canMerge: value }))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(UpdateRepositoryDto, { protectDefaultBranch: false, defaultBranch: 'develop' }))).toHaveLength(0);
    expect((await validate(plainToInstance(UpdateRepositoryDto, { defaultBranch: '' }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(UpdateMemberRoleDto, { canMerge: true }))).toHaveLength(0);
  });
});

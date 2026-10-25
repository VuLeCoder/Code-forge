import { UnauthorizedException } from '@nestjs/common';
import { RepositoryPolicy } from './repository.policy';
import { RepositoriesService } from './repositories.service';

describe('RepositoriesService Git authorization recheck', () => {
  const userId = 'user-1';
  const repositoryId = 'repository-1';

  function fixture(statusAtRecheck: string, repositoryOverrides: Record<string, unknown> = {}) {
    const repository = {
      id: repositoryId,
      ownerId: userId,
      visibility: 'PRIVATE',
      status: 'ACTIVE',
      deletedAt: null,
      storageKey: 'repository.git',
      defaultBranch: 'main',
      storageGeneration: 0,
      members: [],
      ...repositoryOverrides,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: statusAtRecheck }]),
      repository: { findUnique: jest.fn().mockResolvedValue(repository) },
    };
    const db = {
      repository: { findFirst: jest.fn().mockResolvedValue(repository) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const tokens = { authenticate: jest.fn().mockResolvedValue(userId) };
    const service = new RepositoriesService(
      db as never,
      {} as never,
      new RepositoryPolicy(),
      { exists: jest.fn().mockResolvedValue(true) } as never,
      tokens as never,
      {} as never,
      {} as never,
    );
    return { service, tx, tokens, db };
  }

  it('rejects an authenticated private read if the PAT owner is locked before the final Git recheck', async () => {
    const { service, tx, tokens } = fixture('LOCKED', {
      ownerId: 'owner-1',
      visibility: 'PRIVATE',
      members: [{ userId, role: 'READ' }],
    });

    const access = await service.prepareGit('owner', 'repo', 'Bearer pat', 'read');
    expect(tokens.authenticate).toHaveBeenCalledWith('Bearer pat', 'repo:read');
    expect(access.userId).toBe(userId);

    await expect(service.recheckGit(repositoryId, access.userId, 'read')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('continues to allow anonymous reads of public repositories', async () => {
    const { service, tx } = fixture('LOCKED', { ownerId: 'owner-1', visibility: 'PUBLIC' });

    await expect(service.recheckGit(repositoryId, undefined, 'read')).resolves.toMatchObject({ userId: undefined });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('continues to allow active members to read private repositories', async () => {
    const { service, tx } = fixture('ACTIVE', {
      ownerId: 'owner-1',
      visibility: 'PRIVATE',
      members: [{ userId, role: 'READ' }],
    });

    await expect(service.recheckGit(repositoryId, userId, 'read')).resolves.toMatchObject({ userId, operation: 'read' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

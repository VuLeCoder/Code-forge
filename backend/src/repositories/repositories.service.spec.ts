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
      { exists: jest.fn().mockResolvedValue(true), syncDefaultHead: jest.fn().mockResolvedValue(undefined) } as never,
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

describe('RepositoriesService public clone URLs', () => {
  it('uses the configured API base path and emits exactly one slash before Git routes', async () => {
    const repository = {
      id: 'repository-public-url',
      ownerId: 'owner-1',
      name: 'CodeForge',
      description: null,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      deletedAt: null,
      storageGeneration: 0,
      defaultBranch: 'main',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      owner: { username: 'VuCoder' },
    };
    const findMany = jest.fn().mockResolvedValue([repository]);
    const db = { repository: { findMany } };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key !== 'GIT_PUBLIC_BASE_URL') throw new Error(`Unexpected config key: ${key}`);
        return 'https://api.codeforge.test/api/v1/';
      }),
    };
    const service = new RepositoriesService(
      db as never,
      config as never,
      new RepositoryPolicy(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.listPublic();

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.cloneUrl).toBe('https://api.codeforge.test/api/v1/git/VuCoder/CodeForge.git');
    expect(config.getOrThrow).toHaveBeenCalledWith('GIT_PUBLIC_BASE_URL');
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('RepositoriesService repository overview', () => {
  function fixture(visibility = 'PUBLIC') {
    const sha = 'a'.repeat(40);
    const repo = { id: 'repo', ownerId: 'owner', visibility, status: 'ACTIVE', deletedAt: null,
      storageKey: 'storage.git', storageGeneration: 3, defaultBranch: 'develop', members: [] };
    const tx = { $queryRaw: jest.fn(), repository: { findUniqueOrThrow: jest.fn().mockResolvedValue(repo) },
      branchUpdate: { findFirst: jest.fn().mockResolvedValue({ actorId: 'pusher', kind: 'PUSH' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ username: 'bob', avatarUrl: 'data:image/jpeg;base64,current' }) } };
    const db = { repository: { findFirst: jest.fn().mockResolvedValue(repo) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
    const branch = { name: 'develop', commitSha: sha, isDefault: true };
    const storage = { exists: jest.fn().mockResolvedValue(true), validateRef: jest.fn(),
      branches: jest.fn().mockResolvedValue({ branches: [branch], selectedBranch: branch }),
      commit: jest.fn().mockResolvedValue({ sha, subject: 'Change', committedAt: '2026-11-18T00:00:00Z', author: { name: 'Someone else', email: 'secret@example.test' } }),
      commitCount: jest.fn().mockResolvedValue(12), findFiles: jest.fn().mockResolvedValue({ files: ['src/index.ts'], hasMore: false, commitSha: sha }) };
    const release = jest.fn();
    const service = new RepositoriesService(db as never, {} as never, new RepositoryPolicy(), storage as never,
      {} as never, { acquire: jest.fn().mockResolvedValue({ release }) } as never, {} as never);
    return { service, storage, tx, release, sha };
  }
  it('reports the verified pusher for the exact branch, SHA and storage generation without author email', async () => {
    const f = fixture();
    const data = await f.service.read('owner', 'repo', undefined, { overview: true });
    expect(data).toMatchObject({ commitCount: 12, update: { username: 'bob', kind: 'PUSH', avatarUrl: 'data:image/jpeg;base64,current' } });
    expect(JSON.stringify(data)).not.toContain('secret@example.test');
    expect(f.tx.branchUpdate.findFirst).toHaveBeenCalledWith({ where: { repositoryId: 'repo', storageGeneration: 3, branch: 'develop', sha: f.sha }, orderBy: { createdAt: 'desc' } });
    expect(f.storage.commitCount).toHaveBeenCalledWith('storage.git', f.sha);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('reads the current avatar and reflects its removal on subsequent reads', async () => {
    const f = fixture();
    await f.service.read('owner', 'repo', undefined, { overview: true });
    expect(f.tx.user.findUnique).toHaveBeenCalledWith({ where: { id: 'pusher' }, select: { username: true, avatarUrl: true } });
    f.tx.user.findUnique.mockResolvedValueOnce({ username: 'bob', avatarUrl: null });
    expect(await f.service.read('owner', 'repo', undefined, { overview: true })).toMatchObject({ update: { username: 'bob', avatarUrl: null } });
  });
  it('does not invent a pusher for old commits', async () => {
    const f = fixture(); f.tx.branchUpdate.findFirst.mockResolvedValueOnce(null);
    expect(await f.service.read('owner', 'repo', undefined, { overview: true })).toMatchObject({ update: null });
  });
  it('rejects private reads and invalid search input before reading file paths', async () => {
    const f = fixture('PRIVATE');
    await expect(f.service.read('owner', 'repo', undefined, { files: true })).rejects.toThrow();
    expect(f.storage.findFiles).not.toHaveBeenCalled();
    const publicRepo = fixture();
    await expect(publicRepo.service.read('owner', 'repo', undefined, { files: true, q: 'x'.repeat(256) })).rejects.toThrow();
    expect(publicRepo.storage.findFiles).not.toHaveBeenCalled();
  });
  it('searches files at the selected branch head', async () => {
    const f = fixture();
    expect(await f.service.read('owner', 'repo', undefined, { files: true, ref: 'develop', q: 'src/' })).toMatchObject({ files: ['src/index.ts'] });
    expect(f.storage.findFiles).toHaveBeenCalledWith('storage.git', f.sha, 'src/');
  });
});

describe('Repository commit author filters', () => {
  function fixture(visibility = 'PRIVATE') {
    const repo = { id: 'repo', ownerId: 'owner', owner: { username: 'Owner' }, visibility, status: 'ACTIVE', deletedAt: null, members: [{ userId: 'reader', role: 'READ' }] };
    const db = {
      repository: { findFirst: jest.fn().mockResolvedValue(repo) },
      repositoryMember: { findMany: jest.fn().mockResolvedValue([{ user: { username: 'Reader' } }]), findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'outsider', email: 'private@example.test' }) },
    };
    const service = new RepositoriesService(db as never, {} as never, new RepositoryPolicy(), { validateCommitPage: jest.fn(), validateCommitFilters: jest.fn() } as never, {} as never, {} as never, {} as never);
    return { service, db };
  }
  it('offers the owner and accepted members to a reader without exposing emails or roles', async () => {
    const { service } = fixture();
    await expect(service.commitAuthors('owner', 'repo', 'reader')).resolves.toEqual({ authors: [{ username: 'Owner' }, { username: 'Reader' }] });
  });
  it('does not expose private repository members to anonymous viewers', async () => {
    const { service, db } = fixture();
    await expect(service.commitAuthors('owner', 'repo')).rejects.toThrow();
    expect(db.repositoryMember.findMany).not.toHaveBeenCalled();
  });
  it('rejects selecting a user outside the repository before reading Git storage', async () => {
    const { service } = fixture();
    await expect(service.read('owner', 'repo', 'reader', { commits: true, author: 'outsider' })).rejects.toMatchObject({ response: { error: { code: 'INVALID_COMMIT_FILTER' } } });
  });
});

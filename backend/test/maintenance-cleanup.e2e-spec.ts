import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { GitPushJournalService } from '../src/repositories/git-push-journal.service';
import { GitStorageService } from '../src/repositories/git-storage.service';
import { RepositoryLockService } from '../src/repositories/repository-lock.service';
import { RepositoryPurgeService } from '../src/repositories/repository-purge.service';
import { MaintenanceJobsService } from '../src/maintenance/maintenance-jobs.service';

const requireFromBackend = createRequire(__filename);
const schema = `maintenance_cleanup_test_${randomBytes(8).toString('hex')}`;

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function assertIsolatedDatabase(connectionString: string): URL {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !databaseName.endsWith('_test')) {
    throw new Error('Maintenance cleanup E2E requires a loopback PostgreSQL database whose name ends in _test.');
  }
  return url;
}

describe('MaintenanceJobsService PostgreSQL cleanup and purge', () => {
  jest.setTimeout(120_000);
  let admin: PrismaClient | undefined;
  let db: PrismaClient | undefined;
  let locks: RepositoryLockService | undefined;
  let maintenance: MaintenanceJobsService | undefined;
  let purgeService: RepositoryPurgeService | undefined;
  let originalUrl: string | undefined;
  let originalUnpooledUrl: string | undefined;
  let originalStorage: string | undefined;
  let storageRoot: string | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL;
    originalUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
    originalStorage = process.env.GIT_STORAGE_PATH;
    if (!originalUrl || !originalUnpooledUrl) throw new Error('DATABASE_URL and DATABASE_URL_UNPOOLED are required for maintenance cleanup E2E tests.');
    const target = assertIsolatedDatabase(originalUrl);
    const direct = assertIsolatedDatabase(originalUnpooledUrl);
    if (target.hostname !== direct.hostname || target.port !== direct.port || target.pathname !== direct.pathname) {
      throw new Error('Maintenance cleanup E2E requires DATABASE_URL and DATABASE_URL_UNPOOLED to identify the same test database.');
    }

    storageRoot = await mkdtemp(join(tmpdir(), 'code-forge-maintenance-cleanup-'));
    admin = new PrismaClient({ datasourceUrl: originalUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const isolatedUrl = new URL(originalUrl);
    isolatedUrl.searchParams.set('schema', schema);
    process.env.DATABASE_URL = isolatedUrl.toString();
    const isolatedDirectUrl = new URL(originalUnpooledUrl);
    isolatedDirectUrl.searchParams.set('schema', schema);
    process.env.DATABASE_URL_UNPOOLED = isolatedDirectUrl.toString();
    process.env.GIT_STORAGE_PATH = storageRoot;
    execFileSync(process.execPath, [requireFromBackend.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });

    const config = {
      getOrThrow: (key: string) => key === 'DATABASE_URL_UNPOOLED' ? isolatedDirectUrl.toString()
        : key === 'GIT_STORAGE_PATH' ? storageRoot : undefined,
    } as unknown as ConfigService;
    const storage = new GitStorageService(config);
    // Maintenance calls the OS-temp janitor too; keep this DB fixture scoped to its own Git root.
    jest.spyOn(storage, 'cleanupOrphanedTemporaryDirectories').mockResolvedValue(0);
    locks = new RepositoryLockService(config);
    const pushJournal = new GitPushJournalService(db as never, storage, locks);
    purgeService = new RepositoryPurgeService(db as never, storage, locks, pushJournal);
    maintenance = new MaintenanceJobsService(db as never, locks, storage, purgeService, pushJournal);
  }, 60_000);

  afterAll(async () => {
    await maintenance?.onModuleDestroy();
    await db?.$disconnect();
    await locks?.onModuleDestroy();
    if (schemaCreated && admin) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      DATABASE_URL: originalUrl,
      DATABASE_URL_UNPOOLED: originalUnpooledUrl,
      GIT_STORAGE_PATH: originalStorage,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30_000);

  it('applies cleanup and purge batches once per eligible row, retains in-window data, and is safe to repeat', async () => {
    if (!db || !maintenance || !storageRoot) throw new Error('Maintenance test fixture was not initialized.');
    const gitStorageRoot = storageRoot;
    const now = Date.now();
    const owner = await db.user.create({ data: {
      username: 'MaintOwner', normalizedUsername: 'maintowner', email: 'maint-owner@example.test',
      normalizedEmail: 'maint-owner@example.test', passwordHash: 'test-hash',
    } });
    const invitees = await Promise.all(Array.from({ length: 106 }, (_, index) => db!.user.create({ data: {
      username: `MaintInvitee${index}`, normalizedUsername: `maintinvitee${index}`,
      email: `maint-invitee-${index}@example.test`, normalizedEmail: `maint-invitee-${index}@example.test`, passwordHash: 'test-hash',
    } })));

    const anchorId = randomUUID();
    const eligiblePurgeRepos = Array.from({ length: 52 }, (_, index) => {
      const id = randomUUID();
      return { id, ownerId: owner.id, name: `Purge${index}`, normalizedName: `purge${index}`,
        storageKey: `${id}.git`, status: 'DELETED' as const, deletedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
        purgeAfter: new Date(now - 24 * 60 * 60 * 1000), updatedAt: new Date(now) };
    });
    const retainedDeletedRepo = { id: randomUUID(), ownerId: owner.id, name: 'RetainedDeleted', normalizedName: 'retaineddeleted',
      storageKey: `${randomUUID()}.git`, status: 'DELETED' as const, deletedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
      purgeAfter: new Date(now + 24 * 60 * 60 * 1000), updatedAt: new Date(now) };
    const activeWithOldPurgeDate = { id: randomUUID(), ownerId: owner.id, name: 'ActiveOldPurgeDate', normalizedName: 'activeoldpurgedate',
      storageKey: `${randomUUID()}.git`, status: 'ACTIVE' as const, purgeAfter: new Date(now - 24 * 60 * 60 * 1000), updatedAt: new Date(now) };
    const anchorRepo = { id: anchorId, ownerId: owner.id, name: 'InvitationAnchor', normalizedName: 'invitationanchor',
      storageKey: `${anchorId}.git`, updatedAt: new Date(now) };
    await db.repository.createMany({ data: [...eligiblePurgeRepos, retainedDeletedRepo, activeWithOldPurgeDate, anchorRepo] });
    await Promise.all(eligiblePurgeRepos.map((repository) => mkdir(join(gitStorageRoot, repository.storageKey))));
    await Promise.all([retainedDeletedRepo, activeWithOldPurgeDate, anchorRepo].map((repository) => mkdir(join(gitStorageRoot, repository.storageKey))));

    await db.invitation.createMany({ data: [
      ...Array.from({ length: 105 }, (_, index) => ({ repositoryId: anchorId, inviterId: owner.id, inviteeId: invitees[index]!.id,
        role: 'READ' as const, status: 'PENDING' as const, expiresAt: new Date(now - (40 + index) * 24 * 60 * 60 * 1000), updatedAt: new Date(now) })),
      { repositoryId: anchorId, inviterId: owner.id, inviteeId: invitees[105]!.id, role: 'READ', status: 'PENDING',
        expiresAt: new Date(now + 24 * 60 * 60 * 1000), updatedAt: new Date(now) },
    ] });
    await db.session.createMany({ data: [
      ...Array.from({ length: 105 }, (_, index) => ({ userId: owner.id, familyId: randomUUID(), tokenHash: randomUUID(),
        expiresAt: new Date(now - (31 + index) * 24 * 60 * 60 * 1000), updatedAt: new Date(now) })),
      { userId: owner.id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(now + 24 * 60 * 60 * 1000), updatedAt: new Date(now) },
      { userId: owner.id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 29 * 24 * 60 * 60 * 1000), updatedAt: new Date(now) },
      { userId: owner.id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 31 * 24 * 60 * 60 * 1000), updatedAt: new Date(now) },
    ] });
    await db.personalAccessToken.createMany({ data: [
      ...Array.from({ length: 105 }, (_, index) => ({ userId: owner.id, name: `Old token ${index}`,
        tokenPrefix: randomBytes(10).toString('hex'), tokenHash: randomBytes(32).toString('hex'), scopes: ['repo:read'],
        expiresAt: new Date(now - (91 + index) * 24 * 60 * 60 * 1000) })),
      { userId: owner.id, name: 'Recent expiry', tokenPrefix: randomBytes(10).toString('hex'), tokenHash: randomBytes(32).toString('hex'),
        scopes: ['repo:read'], expiresAt: new Date(now - 89 * 24 * 60 * 60 * 1000) },
      { userId: owner.id, name: 'Recent revocation', tokenPrefix: randomBytes(10).toString('hex'), tokenHash: randomBytes(32).toString('hex'),
        scopes: ['repo:read'], expiresAt: new Date(now + 24 * 60 * 60 * 1000), revokedAt: new Date(now - 89 * 24 * 60 * 60 * 1000) },
      { userId: owner.id, name: 'Old revocation', tokenPrefix: randomBytes(10).toString('hex'), tokenHash: randomBytes(32).toString('hex'),
        scopes: ['repo:read'], expiresAt: new Date(now + 24 * 60 * 60 * 1000), revokedAt: new Date(now - 91 * 24 * 60 * 60 * 1000) },
    ] });

    await maintenance.runOnce();
    expect(await db.invitation.groupBy({ by: ['status'], _count: { _all: true } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'PENDING', _count: { _all: 6 } }),
      expect.objectContaining({ status: 'EXPIRED', _count: { _all: 100 } }),
    ]));
    expect(await db.session.count()).toBe(8);
    expect(await db.personalAccessToken.count()).toBe(8);
    expect(await db.repository.count({ where: { id: { in: eligiblePurgeRepos.map(({ id }) => id) } } })).toBe(2);
    expect((await Promise.all(eligiblePurgeRepos.map(({ storageKey }) => pathExists(join(gitStorageRoot, storageKey)))))
      .filter(Boolean)).toHaveLength(2);

    await maintenance.runOnce();
    expect(await db.invitation.groupBy({ by: ['status'], _count: { _all: true } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'PENDING', _count: { _all: 1 } }),
      expect.objectContaining({ status: 'EXPIRED', _count: { _all: 105 } }),
    ]));
    expect(await db.session.count()).toBe(2);
    expect(await db.personalAccessToken.count()).toBe(2);
    expect(await db.repository.count({ where: { id: { in: eligiblePurgeRepos.map(({ id }) => id) } } })).toBe(0);
    expect((await Promise.all(eligiblePurgeRepos.map(({ storageKey }) => pathExists(join(gitStorageRoot, storageKey)))))
      .filter(Boolean)).toHaveLength(0);

    await maintenance.runOnce();
    expect(await db.invitation.groupBy({ by: ['status'], _count: { _all: true } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'PENDING', _count: { _all: 1 } }),
      expect.objectContaining({ status: 'EXPIRED', _count: { _all: 105 } }),
    ]));
    expect(await db.session.count()).toBe(2);
    expect(await db.personalAccessToken.count()).toBe(2);
    expect(await db.repository.findMany({ where: { id: { in: [retainedDeletedRepo.id, activeWithOldPurgeDate.id, anchorId] } }, orderBy: { id: 'asc' } }))
      .toHaveLength(3);
    expect(await db.repository.count()).toBe(3);
    expect(await Promise.all([retainedDeletedRepo, activeWithOldPurgeDate, anchorRepo]
      .map(({ storageKey }) => pathExists(join(gitStorageRoot, storageKey))))).toEqual([true, true, true]);
  });

  it('keeps a newly pending merge journal unresolved until its process-exit grace has elapsed', async () => {
    if (!db || !maintenance) throw new Error('Maintenance test fixture was not initialized.');
    const owner = await db.user.create({ data: {
      username: 'MergeGraceOwner', normalizedUsername: 'mergegraceowner',
      email: 'merge-grace-owner@example.test', normalizedEmail: 'merge-grace-owner@example.test', passwordHash: 'test-hash',
    } });
    const repository = await db.repository.create({ data: {
      ownerId: owner.id, name: 'MergeGrace', normalizedName: 'mergegrace', storageKey: `${randomUUID()}.git`,
    } });
    const pullRequest = await db.pullRequest.create({ data: {
      repositoryId: repository.id, number: 1, authorId: owner.id, title: 'Recovery grace',
      sourceBranch: 'feature/recovery', targetBranch: 'main', storageGeneration: repository.storageGeneration,
      sourceSha: 'a'.repeat(40), targetSha: 'b'.repeat(40),
    } });
    const operation = await db.pullRequestMergeOperation.create({ data: {
      operationId: randomUUID(), repositoryId: repository.id, pullRequestId: pullRequest.id, actorId: owner.id,
      storageGeneration: repository.storageGeneration, expectedSourceSha: pullRequest.sourceSha,
      expectedTargetSha: pullRequest.targetSha, oldTargetSha: pullRequest.targetSha,
      createdAt: new Date(Date.now() - 30_000),
    } });
    const immediateOperation = await db.pullRequestMergeOperation.create({ data: {
      operationId: randomUUID(), repositoryId: repository.id, pullRequestId: pullRequest.id, actorId: owner.id,
      storageGeneration: repository.storageGeneration, expectedSourceSha: pullRequest.sourceSha,
      expectedTargetSha: pullRequest.targetSha, oldTargetSha: pullRequest.targetSha,
      status: 'NEEDS_RECONCILIATION', errorCode: 'RECONCILIATION_UNAVAILABLE', createdAt: new Date(),
    } });
    expect(Date.now() - operation.createdAt.getTime()).toBeGreaterThanOrEqual(0);
    expect(Date.now() - operation.createdAt.getTime()).toBeLessThan(120_000);
    expect(Date.now() - immediateOperation.createdAt.getTime()).toBeGreaterThanOrEqual(0);
    expect(Date.now() - immediateOperation.createdAt.getTime()).toBeLessThan(120_000);

    await maintenance.runOnce();
    expect((await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId: operation.operationId } }))
      .status).toBe('PENDING');
    expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId: immediateOperation.operationId } }))
      .toMatchObject({ status: 'NEEDS_RECONCILIATION', errorCode: 'REF_OUTCOME_UNKNOWN' });

    await db.pullRequestMergeOperation.update({ where: { operationId: operation.operationId },
      data: { createdAt: new Date(Date.now() - 121_000) } });
    await maintenance.runOnce();
    expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId: operation.operationId } }))
      .toMatchObject({ status: 'NEEDS_RECONCILIATION', errorCode: 'REF_OUTCOME_UNKNOWN' });
  });

  it('retains expired repository storage while a merge journal needs reconciliation', async () => {
    if (!db || !purgeService || !storageRoot) throw new Error('Maintenance test fixture was not initialized.');
    const owner = await db.user.create({ data: {
      username: 'PurgeJournalOwner', normalizedUsername: 'purgejournalowner',
      email: 'purge-journal-owner@example.test', normalizedEmail: 'purge-journal-owner@example.test', passwordHash: 'test-hash',
    } });
    const repositoryId = randomUUID();
    const storageKey = `${repositoryId}.git`;
    const repository = await db.repository.create({ data: {
      id: repositoryId, ownerId: owner.id, name: 'PurgeJournal', normalizedName: 'purgejournal', storageKey,
      status: 'DELETED', deletedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      purgeAfter: new Date(Date.now() - 1000),
    } });
    const pullRequest = await db.pullRequest.create({ data: {
      repositoryId: repository.id, number: 1, authorId: owner.id, title: 'Unresolved merge',
      sourceBranch: 'feature/recovery', targetBranch: 'main', storageGeneration: repository.storageGeneration,
      sourceSha: 'a'.repeat(40), targetSha: 'b'.repeat(40),
    } });
    const operationId = randomUUID();
    await db.pullRequestMergeOperation.create({ data: {
      operationId, repositoryId: repository.id, pullRequestId: pullRequest.id, actorId: owner.id,
      storageGeneration: repository.storageGeneration, expectedSourceSha: pullRequest.sourceSha,
      expectedTargetSha: pullRequest.targetSha, oldTargetSha: pullRequest.targetSha,
      status: 'NEEDS_RECONCILIATION', errorCode: 'MERGE_OUTCOME_UNKNOWN',
    } });
    const storagePath = join(storageRoot, storageKey);
    await mkdir(storagePath);

    expect(await purgeService.purgeDue()).toBe(0);
    expect(await db.repository.findUnique({ where: { id: repository.id } })).not.toBeNull();
    expect(await pathExists(storagePath)).toBe(true);

    await db.pullRequestMergeOperation.update({ where: { operationId }, data: { status: 'FAILED' } });
    expect(await purgeService.purgeDue()).toBe(1);
    expect(await db.repository.findUnique({ where: { id: repository.id } })).toBeNull();
    expect(await pathExists(storagePath)).toBe(false);
  });
});

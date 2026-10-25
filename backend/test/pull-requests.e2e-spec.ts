import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { MaintenanceJobsService } from '../src/maintenance/maintenance-jobs.service';
// cookie-parser is CommonJS; its default import is undefined at runtime in this test runner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');

const requireFromBackend = createRequire(__filename);

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function waitForAdvisoryLockWaiter(client: Client, applicationName: string, timeoutMs: number, minimumWaiters = 1) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count
      FROM pg_stat_activity AS activity
      JOIN pg_locks AS lock ON lock.pid = activity.pid
      WHERE activity.application_name = $1 AND activity.datname = current_database()
        AND activity.pid <> pg_backend_pid() AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory' AND activity.query ILIKE '%pg_advisory_lock%'
        AND lock.locktype = 'advisory' AND NOT lock.granted`, [applicationName]);
    if ((result.rows[0]?.count ?? 0) >= minimumWaiters) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Expected ${minimumWaiters} request(s) in the repository advisory-lock wait queue.`);
}

function killChildProcessTree(child: ChildProcessWithoutNullStreams) {
  if (!child.pid) throw new Error('Child API process has no PID.');
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

describe('Pull request HTTP + PostgreSQL + Git', () => {
  const schema = `pull_request_test_${randomBytes(8).toString('hex')}`;
  const lockApplicationName = `pull-requests-${schema.slice(-12)}`;
  let admin: PrismaClient;
  let db: PrismaClient;
  let app: INestApplication;
  let base: string;
  let origin: string;
  let ownerCookie: string;
  let writerCookie: string;
  let originalUrl: string | undefined;
  let originalUnpooledUrl: string | undefined;
  let originalStorage: string | undefined;
  let originalJwtAccessSecret: string | undefined;
  let originalCwd: string | undefined;
  let storageRoot: string;
  let schemaCreated = false;

  const cookie = (response: Response) => response.headers.getSetCookie()
    .map((value) => value.split(';')[0]).join('; ');
  const call = (method: string, path: string, body?: unknown, cookies = ownerCookie) => fetch(`${base}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookies ? { Cookie: cookies } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalUrl = process.env.DATABASE_URL;
    originalUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
    originalStorage = process.env.GIT_STORAGE_PATH;
    originalJwtAccessSecret = process.env.JWT_ACCESS_SECRET;
    if (!originalUrl) throw new Error('DATABASE_URL is required for integration tests');
    const targetDatabase = new URL(originalUrl);
    const databaseName = decodeURIComponent(targetDatabase.pathname.replace(/^\/+/, ''));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(targetDatabase.hostname) || !databaseName.endsWith('_test')) {
      throw new Error('Pull request E2E requires a loopback PostgreSQL database whose name ends in _test.');
    }

    storageRoot = await mkdtemp(join(tmpdir(), 'code-forge-pulls-'));
    process.env.GIT_STORAGE_PATH = storageRoot;
    admin = new PrismaClient({ datasourceUrl: originalUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const isolatedUrl = new URL(originalUrl);
    isolatedUrl.searchParams.set('schema', schema);
    process.env.DATABASE_URL = isolatedUrl.toString();
    process.env.DATABASE_URL_UNPOOLED = isolatedUrl.toString();
    execFileSync(process.execPath, [requireFromBackend.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });

    // This suite receives its DB settings from the test process. A disposable
    // cwd prevents Nest's default ConfigModule setup from reading backend/.env.
    process.chdir(storageRoot);
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('hex');
    const lockUrl = new URL(isolatedUrl.toString());
    lockUrl.searchParams.set('application_name', lockApplicationName);
    process.env.DATABASE_URL_UNPOOLED = lockUrl.toString();

    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      // Keep the real guard installed; this workflow suite does not test
      // throttling, which has dedicated acceptance coverage in auth.e2e-spec.
      .overrideProvider(ThrottlerStorage).useValue({ increment: async (_key: string, ttl: number) => ({
        totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0,
      }) }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    origin = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000').split(',')[0]!.trim();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (admin) {
      if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
    if (originalCwd) process.chdir(originalCwd);
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      DATABASE_URL: originalUrl,
      DATABASE_URL_UNPOOLED: originalUnpooledUrl,
      GIT_STORAGE_PATH: originalStorage,
      JWT_ACCESS_SECRET: originalJwtAccessSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30_000);

  it('uses one compare snapshot across pages and rejects every page after a source ref changes', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'SnapshotOwner', email: 'snapshot-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const snapshotOwnerCookie = cookie(registration);

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'SnapshotDemo', visibility: 'PRIVATE', initializeReadme: true,
    }, snapshotOwnerCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });

    const tokenResponse = await call('POST', 'tokens', {
      name: 'Snapshot compare E2E', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, snapshotOwnerCookie);
    expect(tokenResponse.status).toBe(201);
    const { secret } = await responseJson<{ secret: string }>(tokenResponse);

    const askpass = join(storageRoot, 'snapshot-askpass.sh');
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
      { mode: 0o700 });
    const runGit = promisify(execFile);
    const git = (args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'SnapshotOwner', TEST_GIT_PAT: secret },
    });
    const bare = join(storageRoot, storedRepository.storageKey);
    const repoUrl = `${base}/git/SnapshotOwner/SnapshotDemo.git`;
    const work = join(storageRoot, 'snapshot-writer-clone');
    await git(['clone', repoUrl, work]);
    await git(['-C', work, 'config', 'user.name', 'Snapshot Owner']);
    await git(['-C', work, 'config', 'user.email', 'snapshot-owner@example.test']);
    await git(['-C', work, 'switch', '-c', 'feature/snapshot']);
    await writeFile(join(work, 'snapshot.txt'), 'first version\n');
    await git(['-C', work, 'add', 'snapshot.txt']);
    await git(['-C', work, 'commit', '-m', 'Create snapshot source']);
    await git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/snapshot']);

    const repoPath = 'repos/snapshotowner/snapshotdemo/pulls';
    const createPull = await call('POST', repoPath, {
      title: 'Check snapshot consistency', description: 'Compare pages must share one ref snapshot.',
      sourceBranch: 'feature/snapshot', targetBranch: 'main',
    }, snapshotOwnerCookie);
    expect(createPull.status).toBe(201);
    const createdPull = await responseJson<{ pullRequest: { id: string; number: number } }>(createPull);
    const number = createdPull.pullRequest.number;

    const compareResponse = await call('GET', `${repoPath}/${number}/compare`, undefined, snapshotOwnerCookie);
    expect(compareResponse.status).toBe(200);
    const compare = await responseJson<{ state: string; sourceSha: string; targetSha: string;
      storageGeneration: number }>(compareResponse);
    expect(compare).toMatchObject({ state: 'READY', storageGeneration: storedRepository.storageGeneration });
    const snapshot = { sourceSha: compare.sourceSha, targetSha: compare.targetSha,
      storageGeneration: compare.storageGeneration };
    const pageQuery = new URLSearchParams({ ...Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, String(value)])),
      page: '1', pageSize: '20' }).toString();

    const commitsResponse = await call('GET', `${repoPath}/${number}/commits?${pageQuery}`, undefined, snapshotOwnerCookie);
    expect(commitsResponse.status).toBe(200);
    const commits = await responseJson<{ snapshot: typeof snapshot; commits: { sha: string }[] }>(commitsResponse);
    expect(commits.snapshot).toEqual(snapshot);
    expect(commits.commits[0]?.sha).toBe(snapshot.sourceSha);

    const filesResponse = await call('GET', `${repoPath}/${number}/files?${pageQuery}`, undefined, snapshotOwnerCookie);
    expect(filesResponse.status).toBe(200);
    const files = await responseJson<{ snapshot: typeof snapshot; files: { path: string }[] }>(filesResponse);
    expect(files.snapshot).toEqual(snapshot);
    expect(files.files.map((file) => file.path)).toContain('snapshot.txt');

    const diffResponse = await call('GET', `${repoPath}/${number}/diff?${pageQuery}`, undefined, snapshotOwnerCookie);
    expect(diffResponse.status).toBe(200);
    const diff = await responseJson<{ snapshot: typeof snapshot; files: { path: string; diff: string }[] }>(diffResponse);
    expect(diff.snapshot).toEqual(snapshot);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]?.path).toBe('snapshot.txt');
    expect(diff.files[0]?.diff).toContain('+first version');

    await writeFile(join(work, 'snapshot.txt'), 'first version\nsecond version\n');
    await git(['-C', work, 'add', 'snapshot.txt']);
    await git(['-C', work, 'commit', '-m', 'Advance snapshot source']);
    await git(['-C', work, 'push', 'origin', 'feature/snapshot']);
    const advancedSourceSha = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/snapshot'])).stdout.trim();
    expect(advancedSourceSha).not.toBe(snapshot.sourceSha);

    const beforeStaleRequests = await db.pullRequest.findUniqueOrThrow({ where: { id: createdPull.pullRequest.id } });
    expect(beforeStaleRequests).toMatchObject({ status: 'OPEN', version: 1, sourceSha: snapshot.sourceSha, targetSha: snapshot.targetSha });
    const mergeOperationCount = await db.pullRequestMergeOperation.count({ where: { pullRequestId: beforeStaleRequests.id } });
    const pullAuditCount = await db.auditLog.count({ where: { targetId: beforeStaleRequests.id } });
    const repositoryAuditCount = await db.auditLog.count({ where: { targetId: repository.id } });
    const pushOperationCount = await db.gitPushOperation.count({ where: { repositoryId: repository.id } });

    for (const section of ['commits', 'files', 'diff']) {
      const staleResponse = await call('GET', `${repoPath}/${number}/${section}?${pageQuery}`, undefined, snapshotOwnerCookie);
      expect(staleResponse.status).toBe(409);
      expect(await responseJson<{ error: { code: string } }>(staleResponse))
        .toMatchObject({ error: { code: 'STALE_COMPARE' } });
    }

    const afterStaleRequests = await db.pullRequest.findUniqueOrThrow({ where: { id: beforeStaleRequests.id } });
    expect(afterStaleRequests).toMatchObject({ status: 'OPEN', version: beforeStaleRequests.version,
      sourceSha: beforeStaleRequests.sourceSha, targetSha: beforeStaleRequests.targetSha });
    expect(await db.pullRequestMergeOperation.count({ where: { pullRequestId: beforeStaleRequests.id } })).toBe(mergeOperationCount);
    expect(await db.auditLog.count({ where: { targetId: beforeStaleRequests.id } })).toBe(pullAuditCount);
    expect(await db.auditLog.count({ where: { targetId: repository.id } })).toBe(repositoryAuditCount);
    expect(await db.gitPushOperation.count({ where: { repositoryId: repository.id } })).toBe(pushOperationCount);
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/snapshot'])).stdout.trim()).toBe(advancedSourceSha);
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(snapshot.targetSha);
  }, 60_000);

  it('rejects pull request creation for unrelated histories without side effects', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'UnrelatedOwner', email: 'unrelated-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const unrelatedOwnerCookie = cookie(registration);

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'UnrelatedDemo', visibility: 'PRIVATE', initializeReadme: true,
    }, unrelatedOwnerCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });

    const tokenResponse = await call('POST', 'tokens', {
      name: 'Unrelated history E2E', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, unrelatedOwnerCookie);
    expect(tokenResponse.status).toBe(201);
    const { secret } = await responseJson<{ secret: string }>(tokenResponse);

    const askpass = join(storageRoot, 'unrelated-askpass.sh');
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
      { mode: 0o700 });
    const runGit = promisify(execFile);
    const git = (args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'UnrelatedOwner', TEST_GIT_PAT: secret },
    });
    const bare = join(storageRoot, storedRepository.storageKey);
    const repoUrl = `${base}/git/UnrelatedOwner/UnrelatedDemo.git`;
    const work = join(storageRoot, 'unrelated-writer-clone');
    await git(['clone', repoUrl, work]);
    await git(['-C', work, 'config', 'user.name', 'Unrelated Owner']);
    await git(['-C', work, 'config', 'user.email', 'unrelated-owner@example.test']);
    await git(['-C', work, 'switch', '--orphan', 'feature/unrelated']);
    await writeFile(join(work, 'unrelated.txt'), 'This root commit has no shared history.\n');
    await git(['-C', work, 'add', 'unrelated.txt']);
    await git(['-C', work, 'commit', '-m', 'Create unrelated root history']);
    await git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/unrelated']);

    const targetShaBefore = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim();
    const sourceShaBefore = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/unrelated'])).stdout.trim();
    expect(sourceShaBefore).not.toBe(targetShaBefore);
    const owner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'unrelatedowner' } });
    const pullCountBefore = await db.pullRequest.count({ where: { repositoryId: repository.id } });
    const mergeOperationCountBefore = await db.pullRequestMergeOperation.count({ where: { repositoryId: repository.id } });
    const auditCountBefore = await db.auditLog.count({ where: { actorId: owner.id } });
    const pushOperationCountBefore = await db.gitPushOperation.count({ where: { repositoryId: repository.id } });

    const createPull = await call('POST', 'repos/unrelatedowner/unrelateddemo/pulls', {
      title: 'Reject unrelated history', description: 'There is no common ancestor to compare or merge.',
      sourceBranch: 'feature/unrelated', targetBranch: 'main',
    }, unrelatedOwnerCookie);
    expect(createPull.status).toBe(409);
    expect(await responseJson<{ error: { code: string } }>(createPull))
      .toMatchObject({ error: { code: 'NO_MERGE_BASE' } });

    expect(await db.pullRequest.count({ where: { repositoryId: repository.id } })).toBe(pullCountBefore);
    expect(await db.pullRequestMergeOperation.count({ where: { repositoryId: repository.id } })).toBe(mergeOperationCountBefore);
    expect(await db.auditLog.count({ where: { actorId: owner.id } })).toBe(auditCountBefore);
    expect(await db.gitPushOperation.count({ where: { repositoryId: repository.id } })).toBe(pushOperationCountBefore);
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(targetShaBefore);
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/unrelated'])).stdout.trim()).toBe(sourceShaBefore);
  }, 60_000);

  it('lets a PR author and repository owner update lifecycle state while denying other WRITE members', async () => {
    const ownerRegistration = await call('POST', 'auth/register', {
      username: 'LifecycleOwner', email: 'lifecycle-owner@example.test', password: 'test-password-123',
    }, '');
    expect(ownerRegistration.status).toBe(201);
    const lifecycleOwnerCookie = cookie(ownerRegistration);

    const authorRegistration = await call('POST', 'auth/register', {
      username: 'LifecycleAuthor', email: 'lifecycle-author@example.test', password: 'test-password-123',
    }, '');
    expect(authorRegistration.status).toBe(201);
    const authorCookie = cookie(authorRegistration);

    const otherWriterRegistration = await call('POST', 'auth/register', {
      username: 'LifecycleOther', email: 'lifecycle-other@example.test', password: 'test-password-123',
    }, '');
    expect(otherWriterRegistration.status).toBe(201);
    const otherWriterCookie = cookie(otherWriterRegistration);

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'LifecycleDemo', visibility: 'PRIVATE', initializeReadme: true,
    }, lifecycleOwnerCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const author = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'lifecycleauthor' } });

    for (const username of ['LifecycleAuthor', 'LifecycleOther']) {
      const invitationResponse = await call('POST', 'repos/lifecycleowner/lifecycledemo/invitations', {
        username, role: 'WRITE',
      }, lifecycleOwnerCookie);
      expect(invitationResponse.status).toBe(201);
      const invitation = await responseJson<{ invitation: { id: string } }>(invitationResponse);
      const accepted = await call('POST', `invitations/${invitation.invitation.id}/accept`, undefined,
        username === 'LifecycleAuthor' ? authorCookie : otherWriterCookie);
      expect(accepted.status).toBe(201);
    }

    const pullRequest = await db.pullRequest.create({ data: {
      repositoryId: storedRepository.id,
      number: 1,
      authorId: author.id,
      title: 'Original title',
      description: 'Original description',
      sourceBranch: 'feature/lifecycle',
      targetBranch: 'main',
      storageGeneration: storedRepository.storageGeneration,
      sourceSha: 'a'.repeat(40),
      targetSha: 'b'.repeat(40),
    } });
    const detailPath = 'repos/lifecycleowner/lifecycledemo/pulls/1';

    const authorDetailResponse = await call('GET', detailPath, undefined, authorCookie);
    expect(authorDetailResponse.status).toBe(200);
    expect(await responseJson<{ permissions: { canEdit: boolean; canMerge: boolean } }>(authorDetailResponse))
      .toMatchObject({ permissions: { canEdit: true, canMerge: false } });

    const otherWriterDetailResponse = await call('GET', detailPath, undefined, otherWriterCookie);
    expect(otherWriterDetailResponse.status).toBe(200);
    expect(await responseJson<{ permissions: { canEdit: boolean; canMerge: boolean } }>(otherWriterDetailResponse))
      .toMatchObject({ permissions: { canEdit: false, canMerge: false } });

    const deniedEdit = await call('PATCH', detailPath, { title: 'Unauthorized title' }, otherWriterCookie);
    expect(deniedEdit.status).toBe(403);
    const deniedClose = await call('PATCH', detailPath, { state: 'CLOSED' }, otherWriterCookie);
    expect(deniedClose.status).toBe(403);
    const unchanged = await call('GET', detailPath, undefined, lifecycleOwnerCookie);
    expect(await responseJson<{ pullRequest: { title: string; status: string; version: number } }>(unchanged))
      .toMatchObject({ pullRequest: { title: 'Original title', status: 'OPEN', version: 1 } });

    const authorEdit = await call('PATCH', detailPath, {
      title: 'Author title', description: 'Edited by the PR author',
    }, authorCookie);
    expect(authorEdit.status).toBe(200);
    expect(await responseJson<{ pullRequest: { title: string; description: string; status: string; version: number } }>(authorEdit))
      .toMatchObject({ pullRequest: { title: 'Author title', description: 'Edited by the PR author', status: 'OPEN', version: 2 } });

    const ownerEdit = await call('PATCH', detailPath, { title: 'Owner title' }, lifecycleOwnerCookie);
    expect(ownerEdit.status).toBe(200);
    expect(await responseJson<{ pullRequest: { title: string; version: number }; permissions: { canEdit: boolean; canMerge: boolean } }>(ownerEdit))
      .toMatchObject({ pullRequest: { title: 'Owner title', version: 3 }, permissions: { canEdit: true, canMerge: true } });

    const close = await call('PATCH', detailPath, { state: 'CLOSED' }, authorCookie);
    expect(close.status).toBe(200);
    expect(await responseJson<{ pullRequest: { status: string; version: number } }>(close))
      .toMatchObject({ pullRequest: { status: 'CLOSED', version: 4 } });

    const reopen = await call('PATCH', detailPath, { state: 'OPEN' }, authorCookie);
    expect(reopen.status).toBe(200);
    expect(await responseJson<{ pullRequest: { status: string; version: number } }>(reopen))
      .toMatchObject({ pullRequest: { status: 'OPEN', version: 5 } });
    expect(await db.auditLog.count({ where: { targetId: pullRequest.id, action: 'PULL_REQUEST_UPDATED' } })).toBe(4);
  }, 60_000);

  it('retains PR history and rejects a pre-reset merge after normal Git storage recovery', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'StorageResetOwner', email: 'storage-reset-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const resetOwnerCookie = cookie(registration);

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'StorageLoss', visibility: 'PRIVATE', initializeReadme: true,
    }, resetOwnerCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepository.storageKey);
    const git = (args: string[], input?: string) => execFileSync('git', ['--git-dir', bare, ...args], {
      encoding: 'utf8', input,
    }).trim();
    const targetSha = git(['rev-parse', 'refs/heads/main']);
    const blobSha = git(['hash-object', '-w', '--stdin'], 'source content\n');
    const treeSha = git(['mktree', '-z'], `100644 blob ${blobSha}\tnew-file.txt\0`);
    const sourceSha = git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', treeSha,
      '-p', targetSha, '-m', 'Create source branch']);
    git(['update-ref', 'refs/heads/feature/storage-loss', sourceSha]);

    const pullsPath = 'repos/storageresetowner/storageloss/pulls';
    const createResponse = await call('POST', pullsPath, {
      title: 'PR survives source storage loss', sourceBranch: 'feature/storage-loss', targetBranch: 'main',
    }, resetOwnerCookie);
    expect(createResponse.status).toBe(201);
    const created = await responseJson<{ pullRequest: { id: string; number: number; version: number; status: string } }>(createResponse);
    const pullRequestId = created.pullRequest.id;

    const initialCompareResponse = await call('GET', `${pullsPath}/${created.pullRequest.number}/compare`, undefined, resetOwnerCookie);
    expect(initialCompareResponse.status).toBe(200);
    const initialCompare = await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number }>(initialCompareResponse);
    expect(initialCompare).toMatchObject({ state: 'READY', sourceSha, targetSha, storageGeneration: storedRepository.storageGeneration });

    // This is the one bare repository created by this test under its beforeAll-owned temp root.
    expect(resolve(bare)).toBe(resolve(storageRoot, storedRepository.storageKey));
    await rm(bare, { recursive: true, force: true });

    const recoveryRead = await call('GET', 'repos/storageresetowner/storageloss/branches', undefined, resetOwnerCookie);
    expect(recoveryRead.status).toBe(200);
    const recoveredStorage = await responseJson<{ branches: unknown[]; storageState: string; storageGeneration: number }>(recoveryRead);
    expect(recoveredStorage).toMatchObject({ branches: [], storageState: 'RESET', storageGeneration: storedRepository.storageGeneration + 1 });

    const compareAfterResetResponse = await call('GET', `${pullsPath}/${created.pullRequest.number}/compare`, undefined, resetOwnerCookie);
    expect(compareAfterResetResponse.status).toBe(200);
    expect(await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number }>(compareAfterResetResponse))
      .toMatchObject({ state: 'STORAGE_RESET', sourceSha, targetSha, storageGeneration: recoveredStorage.storageGeneration });

    const retained = await db.pullRequest.findUniqueOrThrow({ where: { id: pullRequestId } });
    expect(retained).toMatchObject({ id: pullRequestId, status: 'OPEN', storageGeneration: storedRepository.storageGeneration });
    const preMergeRefs = git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/']);
    const mergeResponse = await call('POST', `${pullsPath}/${created.pullRequest.number}/merge`, {
      operationId: randomUUID(), expectedSourceSha: initialCompare.sourceSha, expectedTargetSha: initialCompare.targetSha,
      storageGeneration: initialCompare.storageGeneration, version: created.pullRequest.version,
    }, resetOwnerCookie);
    expect(mergeResponse.status).toBe(409);
    expect(await responseJson<{ error: { code: string } }>(mergeResponse)).toMatchObject({ error: { code: 'STALE_COMPARE' } });
    expect(git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/'])).toBe(preMergeRefs);
    expect(await db.pullRequest.findUniqueOrThrow({ where: { id: pullRequestId } })).toMatchObject({ status: 'OPEN', mergeCommitSha: null });
    expect(await db.pullRequestMergeOperation.count({ where: { pullRequestId } })).toBe(0);
  }, 60_000);

  it('rejects merges when compared refs advance or disappear without changing refs or merge metadata', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'StaleRefsOwner', email: 'stale-refs-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const staleRefsCookie = cookie(registration);
    const repositoryResponse = await call('POST', 'repositories', {
      name: 'StaleRefs', visibility: 'PRIVATE', initializeReadme: true,
    }, staleRefsCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepository.storageKey);
    const git = (args: string[], input?: string) => execFileSync('git', ['--git-dir', bare, ...args], {
      encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const branchSha = (branch: string) => {
      const refs = git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/']);
      return refs.split('\n').map((line) => line.split('\t')).find(([ref]) => ref === `refs/heads/${branch}`)?.[1];
    };
    const commitWithFile = (parentSha: string, filename: string, content: string, message: string) => {
      const blobSha = git(['hash-object', '-w', '--stdin'], content);
      const treeSha = git(['mktree'], `100644 blob ${blobSha}\t${filename}\n`);
      return git(['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', 'commit-tree', treeSha,
        '-p', parentSha, '-m', message]);
    };
    const initialTargetSha = git(['rev-parse', 'refs/heads/main']);
    const cases = [
      { name: 'source-sha-advanced', mutation: 'advance-source' },
      { name: 'target-sha-advanced', mutation: 'advance-target' },
      { name: 'source-deleted', mutation: 'delete-source' },
      { name: 'target-deleted', mutation: 'delete-target' },
    ] as const;

    for (const scenario of cases) {
      const targetBranch = `target/${scenario.name}`;
      const sourceBranch = `feature/${scenario.name}`;
      git(['update-ref', `refs/heads/${targetBranch}`, initialTargetSha]);
      const sourceSha = commitWithFile(initialTargetSha, `${scenario.name}.txt`, `original ${scenario.name}\n`, scenario.name);
      git(['update-ref', `refs/heads/${sourceBranch}`, sourceSha]);

      const repoPath = 'repos/stalerefsowner/stalerefs/pulls';
      const createdResponse = await call('POST', repoPath, {
        title: `Stale refs ${scenario.name}`, sourceBranch, targetBranch,
      }, staleRefsCookie);
      expect(createdResponse.status).toBe(201);
      const created = await responseJson<{ pullRequest: { id: string; number: number; version: number } }>(createdResponse);
      const comparisonResponse = await call('GET', `${repoPath}/${created.pullRequest.number}/compare`, undefined, staleRefsCookie);
      expect(comparisonResponse.status).toBe(200);
      const comparison = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(comparisonResponse);
      expect(comparison).toMatchObject({ sourceSha, targetSha: initialTargetSha, storageGeneration: storedRepository.storageGeneration });

      let expectedSourceSha = sourceSha;
      let expectedTargetSha = initialTargetSha;
      if (scenario.mutation === 'advance-source') {
        expectedSourceSha = commitWithFile(sourceSha, `${scenario.name}.txt`, `advanced ${scenario.name}\n`, 'advance source');
        git(['update-ref', `refs/heads/${sourceBranch}`, expectedSourceSha]);
      } else if (scenario.mutation === 'advance-target') {
        expectedTargetSha = commitWithFile(initialTargetSha, `target-${scenario.name}.txt`, 'advanced target\n', 'advance target');
        git(['update-ref', `refs/heads/${targetBranch}`, expectedTargetSha]);
      } else if (scenario.mutation === 'delete-source') {
        git(['update-ref', '-d', `refs/heads/${sourceBranch}`]);
        expectedSourceSha = '';
      } else {
        git(['update-ref', '-d', `refs/heads/${targetBranch}`]);
        expectedTargetSha = '';
      }

      const refsBeforeMerge = git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/']);
      const auditRowsBeforeMerge = await db.auditLog.count({ where: { targetId: created.pullRequest.id } });
      const mergeResponse = await call('POST', `${repoPath}/${created.pullRequest.number}/merge`, {
        operationId: randomUUID(), expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: created.pullRequest.version,
      }, staleRefsCookie);
      if (mergeResponse.status !== 409) {
        throw new Error(`Unexpected merge response for ${scenario.name}: ${JSON.stringify(await mergeResponse.clone().json())}`);
      }
      expect(await responseJson<{ error: { code: string } }>(mergeResponse)).toMatchObject({ error: { code: 'STALE_COMPARE' } });
      expect(git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/'])).toBe(refsBeforeMerge);
      expect(branchSha(sourceBranch) ?? '').toBe(expectedSourceSha);
      expect(branchSha(targetBranch) ?? '').toBe(expectedTargetSha);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: created.pullRequest.id } }))
        .toMatchObject({ status: 'OPEN', version: created.pullRequest.version, mergeCommitSha: null, mergedById: null });
      expect(await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } })).toBe(0);
      expect(await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(0);
      expect(await db.auditLog.count({ where: { targetId: created.pullRequest.id } })).toBe(auditRowsBeforeMerge);
    }
  }, 60_000);

  it('rechecks owner lock state after a merge leaves the advisory-lock wait queue', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'MergeLockOwner', email: 'merge-lock-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const ownerCookieForTest = cookie(registration);
    const registeredOwner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'mergelockowner' } });

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'MergeLockState', visibility: 'PRIVATE', initializeReadme: true,
    }, ownerCookieForTest);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepository.storageKey);
    const work = join(storageRoot, 'merge-lock-state-clone');
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Merge Lock Owner']);
    git(['-C', work, 'config', 'user.email', 'merge-lock-owner@example.test']);
    git(['-C', work, 'switch', '-c', 'feature/owner-lock-race']);
    await writeFile(join(work, 'owner-lock.txt'), 'owner lock race fixture\n');
    git(['-C', work, 'add', 'owner-lock.txt']);
    git(['-C', work, 'commit', '-m', 'Create owner lock race fixture']);
    git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/owner-lock-race']);

    const repoPath = 'repos/mergelockowner/mergelockstate/pulls';
    const createdResponse = await call('POST', repoPath, {
      title: 'Recheck owner lock before merge', sourceBranch: 'feature/owner-lock-race', targetBranch: 'main',
    }, ownerCookieForTest);
    expect(createdResponse.status).toBe(201);
    const created = await responseJson<{ pullRequest: { id: string; number: number; version: number } }>(createdResponse);
    const comparisonResponse = await call('GET', `${repoPath}/${created.pullRequest.number}/compare`, undefined, ownerCookieForTest);
    expect(comparisonResponse.status).toBe(200);
    const comparison = await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number }>(comparisonResponse);
    expect(comparison.state).toBe('READY');

    const refsBeforeMerge = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']);
    const operationCountBefore = await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } });
    const successAuditCountBefore = await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_MERGED' } });
    expect(operationCountBefore).toBe(0);
    expect(successAuditCountBefore).toBe(0);

    const barrierUrl = new URL(process.env.DATABASE_URL_UNPOOLED!);
    barrierUrl.searchParams.set('application_name', `${lockApplicationName}-barrier`);
    const barrier = new Client({ connectionString: barrierUrl.toString(), connectionTimeoutMillis: 5_000 });
    let barrierLockHeld = false;
    try {
      await barrier.connect();
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [repository.id]);
      barrierLockHeld = true;

      const operationId = randomUUID();
      const mergeRequest = call('POST', `${repoPath}/${created.pullRequest.number}/merge`, {
        operationId, expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: created.pullRequest.version,
      }, ownerCookieForTest);

      // The PostgreSQL wait event proves the request passed authentication and
      // initial owner authorization, then queued specifically on the test lock.
      await waitForAdvisoryLockWaiter(barrier, lockApplicationName, 10_000);
      await db.user.update({ where: { id: registeredOwner.id }, data: { status: 'LOCKED', lockedAt: new Date() } });

      const unlocked = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repository.id]);
      expect(unlocked.rows[0]?.pg_advisory_unlock).toBe(true);
      barrierLockHeld = false;

      const mergeResponse = await mergeRequest;
      expect(mergeResponse.status).toBe(403);
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']))
        .toBe(refsBeforeMerge);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: created.pullRequest.id } }))
        .toMatchObject({ status: 'OPEN', mergeCommitSha: null, mergedById: null });
      expect(await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } }))
        .toBe(operationCountBefore);
      expect(await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_MERGED' } }))
        .toBe(successAuditCountBefore);
    } finally {
      if (barrierLockHeld) await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repository.id]).catch(() => undefined);
      await barrier.end();
    }
  }, 60_000);

  it('rejects a queued merge when an earlier queued PR edit advances its version', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'MergeStaleVersionOwner', email: 'merge-stale-version-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const staleOwnerCookie = cookie(registration);

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'MergeStaleVersion', visibility: 'PRIVATE', initializeReadme: true,
    }, staleOwnerCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepository.storageKey);
    const work = join(storageRoot, 'merge-stale-version-clone');
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Merge Stale Version Owner']);
    git(['-C', work, 'config', 'user.email', 'merge-stale-version-owner@example.test']);
    git(['-C', work, 'switch', '-c', 'feature/stale-version']);
    await writeFile(join(work, 'stale-version.txt'), 'stale version fixture\n');
    git(['-C', work, 'add', 'stale-version.txt']);
    git(['-C', work, 'commit', '-m', 'Create stale version fixture']);
    git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/stale-version']);

    const repoPath = 'repos/mergestaleversionowner/mergestaleversion/pulls';
    const createdResponse = await call('POST', repoPath, {
      title: 'Queued title v1', sourceBranch: 'feature/stale-version', targetBranch: 'main',
    }, staleOwnerCookie);
    expect(createdResponse.status).toBe(201);
    const created = await responseJson<{ pullRequest: { id: string; number: number; version: number } }>(createdResponse);
    expect(created.pullRequest.version).toBe(1);
    const detailPath = `${repoPath}/${created.pullRequest.number}`;
    const comparisonResponse = await call('GET', `${detailPath}/compare`, undefined, staleOwnerCookie);
    expect(comparisonResponse.status).toBe(200);
    const comparison = await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number }>(comparisonResponse);
    expect(comparison.state).toBe('READY');

    const refsBefore = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']);
    const mergeOperationsBefore = await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } });
    const mergeAuditsBefore = await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_MERGED' } });
    expect(mergeOperationsBefore).toBe(0);
    expect(mergeAuditsBefore).toBe(0);

    const barrierUrl = new URL(process.env.DATABASE_URL_UNPOOLED!);
    barrierUrl.searchParams.set('application_name', `${lockApplicationName}-stale-version-barrier`);
    const barrier = new Client({ connectionString: barrierUrl.toString(), connectionTimeoutMillis: 5_000 });
    let barrierLockHeld = false;
    let editRequest: Promise<Response> | undefined;
    let mergeRequest: Promise<Response> | undefined;
    try {
      await barrier.connect();
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [repository.id]);
      barrierLockHeld = true;

      editRequest = call('PATCH', detailPath, { title: 'Queued title v2' }, staleOwnerCookie);
      await waitForAdvisoryLockWaiter(barrier, lockApplicationName, 10_000, 1);

      mergeRequest = call('POST', `${detailPath}/merge`, {
        operationId: randomUUID(), expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: created.pullRequest.version,
      }, staleOwnerCookie);
      await waitForAdvisoryLockWaiter(barrier, lockApplicationName, 10_000, 2);

      const unlocked = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repository.id]);
      expect(unlocked.rows[0]?.pg_advisory_unlock).toBe(true);
      barrierLockHeld = false;

      const editResponse = await editRequest;
      expect(editResponse.status).toBe(200);
      expect(await responseJson<{ pullRequest: { title: string; status: string; version: number } }>(editResponse))
        .toMatchObject({ pullRequest: { title: 'Queued title v2', status: 'OPEN', version: 2 } });

      const mergeResponse = await mergeRequest;
      expect(mergeResponse.status).toBe(409);
      expect(await responseJson<{ error: { code: string } }>(mergeResponse))
        .toMatchObject({ error: { code: 'STALE_COMPARE' } });
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']))
        .toBe(refsBefore);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: created.pullRequest.id } }))
        .toMatchObject({ title: 'Queued title v2', status: 'OPEN', version: 2, mergeCommitSha: null, mergedById: null });
      expect(await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } }))
        .toBe(mergeOperationsBefore);
      expect(await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_MERGED' } }))
        .toBe(mergeAuditsBefore);
    } finally {
      if (barrierLockHeld) await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repository.id]).catch(() => undefined);
      await Promise.allSettled([editRequest, mergeRequest].filter((request): request is Promise<Response> => request !== undefined));
      await barrier.end();
    }
  }, 60_000);

  it('rejects a queued merge after an earlier queued close changes the PR state', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'MergeCloseRaceOwner', email: 'merge-close-race-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registration.status).toBe(201);
    const closeRaceOwnerCookie = cookie(registration);

    const repositoryResponse = await call('POST', 'repositories', {
      name: 'MergeCloseRace', visibility: 'PRIVATE', initializeReadme: true,
    }, closeRaceOwnerCookie);
    expect(repositoryResponse.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(repositoryResponse);
    const storedRepository = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepository.storageKey);
    const work = join(storageRoot, 'merge-close-race-clone');
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Merge Close Race Owner']);
    git(['-C', work, 'config', 'user.email', 'merge-close-race-owner@example.test']);
    git(['-C', work, 'switch', '-c', 'feature/close-race']);
    await writeFile(join(work, 'close-race.txt'), 'close before queued merge\n');
    git(['-C', work, 'add', 'close-race.txt']);
    git(['-C', work, 'commit', '-m', 'Create close race fixture']);
    git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/close-race']);

    const repoPath = 'repos/mergecloseraceowner/mergecloserace/pulls';
    const createdResponse = await call('POST', repoPath, {
      title: 'Close while merge is queued', sourceBranch: 'feature/close-race', targetBranch: 'main',
    }, closeRaceOwnerCookie);
    expect(createdResponse.status).toBe(201);
    const created = await responseJson<{ pullRequest: { id: string; number: number; version: number } }>(createdResponse);
    const detailPath = `${repoPath}/${created.pullRequest.number}`;
    const comparisonResponse = await call('GET', `${detailPath}/compare`, undefined, closeRaceOwnerCookie);
    expect(comparisonResponse.status).toBe(200);
    const comparison = await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number }>(comparisonResponse);
    expect(comparison.state).toBe('READY');

    const refsBefore = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']);
    const mergeOperationsBefore = await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } });
    const mergeAuditsBefore = await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_MERGED' } });
    expect(mergeOperationsBefore).toBe(0);
    expect(mergeAuditsBefore).toBe(0);

    const barrierUrl = new URL(process.env.DATABASE_URL_UNPOOLED!);
    barrierUrl.searchParams.set('application_name', `${lockApplicationName}-close-race-barrier`);
    const barrier = new Client({ connectionString: barrierUrl.toString(), connectionTimeoutMillis: 5_000 });
    let barrierLockHeld = false;
    let closeRequest: Promise<Response> | undefined;
    let mergeRequest: Promise<Response> | undefined;
    try {
      await barrier.connect();
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [repository.id]);
      barrierLockHeld = true;

      // Queue the state transition first, then the merge against the identical snapshot.
      // PostgreSQL grants the repository advisory lock in queue order after release.
      closeRequest = call('PATCH', detailPath, { state: 'CLOSED' }, closeRaceOwnerCookie);
      await waitForAdvisoryLockWaiter(barrier, lockApplicationName, 10_000, 1);

      mergeRequest = call('POST', `${detailPath}/merge`, {
        operationId: randomUUID(), expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: created.pullRequest.version,
      }, closeRaceOwnerCookie);
      await waitForAdvisoryLockWaiter(barrier, lockApplicationName, 10_000, 2);

      const unlocked = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repository.id]);
      expect(unlocked.rows[0]?.pg_advisory_unlock).toBe(true);
      barrierLockHeld = false;

      const closeResponse = await closeRequest;
      expect(closeResponse.status).toBe(200);
      expect(await responseJson<{ pullRequest: { status: string; version: number } }>(closeResponse))
        .toMatchObject({ pullRequest: { status: 'CLOSED', version: created.pullRequest.version + 1 } });

      const mergeResponse = await mergeRequest;
      expect(mergeResponse.status).toBe(409);
      expect(await responseJson<{ error: { code: string } }>(mergeResponse))
        .toMatchObject({ error: { code: 'PULL_REQUEST_NOT_OPEN' } });
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']))
        .toBe(refsBefore);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: created.pullRequest.id } }))
        .toMatchObject({ status: 'CLOSED', version: created.pullRequest.version + 1, mergeCommitSha: null, mergedById: null, mergedAt: null });
      expect(await db.pullRequestMergeOperation.count({ where: { pullRequestId: created.pullRequest.id } }))
        .toBe(mergeOperationsBefore);
      expect(await db.auditLog.count({ where: { targetId: created.pullRequest.id,
        action: { in: ['PULL_REQUEST_MERGED', 'PULL_REQUEST_MERGE_RECONCILED'] } } }))
        .toBe(mergeAuditsBefore);
      expect(await db.auditLog.count({ where: { targetId: created.pullRequest.id, action: 'PULL_REQUEST_UPDATED' } })).toBe(1);
    } finally {
      if (barrierLockHeld) await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repository.id]).catch(() => undefined);
      await Promise.allSettled([closeRequest, mergeRequest].filter((request): request is Promise<Response> => request !== undefined));
      await barrier.end();
    }
  }, 60_000);

  it('creates, enforces private PR read isolation, and owner-merges while preserving both Git parents', async () => {
    const registered = await call('POST', 'auth/register', {
      username: 'PullOwner', email: 'pull-owner@example.test', password: 'test-password-123',
    });
    expect(registered.status).toBe(201);
    ownerCookie = cookie(registered);

    const writerRegistered = await call('POST', 'auth/register', {
      username: 'PullWriter', email: 'pull-writer@example.test', password: 'test-password-123',
    }, '');
    expect(writerRegistered.status).toBe(201);
    writerCookie = cookie(writerRegistered);

    const createdRepo = await call('POST', 'repositories', {
      name: 'PullDemo', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);
    const inviteResponse = await call('POST', 'repos/pullowner/pulldemo/invitations', {
      username: 'PullWriter', role: 'WRITE',
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await responseJson<{ invitation: { id: string; role: string } }>(inviteResponse);
    expect(invite.invitation.role).toBe('WRITE');
    const acceptedResponse = await call('POST', `invitations/${invite.invitation.id}/accept`, undefined, writerCookie);
    expect(acceptedResponse.status).toBe(201);
    expect(await responseJson<{ success: boolean; role: string }>(acceptedResponse)).toMatchObject({ success: true, role: 'WRITE' });

    const tokenResponse = await call('POST', 'tokens', {
      name: 'PR E2E', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, writerCookie);
    expect(tokenResponse.status).toBe(201);
    const token = await responseJson<{ token: { id: string }; secret: string }>(tokenResponse);
    expect(token.secret).toMatch(/^cfg_[a-f0-9]{16}_[a-f0-9]{64}$/);
    const storedToken = await db.personalAccessToken.findUniqueOrThrow({ where: { id: token.token.id } });
    expect(storedToken.tokenHash).not.toBe(token.secret);

    const askpass = join(storageRoot, 'git-askpass.sh');
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
      { mode: 0o700 });
    const runGit = promisify(execFile);
    const git = (args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'PullWriter', TEST_GIT_PAT: token.secret },
    });
    const repoUrl = `${base}/git/PullOwner/PullDemo.git`;
    const writerWork = join(storageRoot, 'writer-clone');
    await git(['clone', repoUrl, writerWork]);
    await git(['-C', writerWork, 'config', 'user.name', 'Pull Writer']);
    await git(['-C', writerWork, 'config', 'user.email', 'pull-writer@example.test']);
    await git(['-C', writerWork, 'switch', '-c', 'feature/ui/add-button']);
    await writeFile(join(writerWork, 'feature.txt'), 'button: enabled\n');
    await git(['-C', writerWork, 'add', 'feature.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Add feature']);
    const sourceSha = (await git(['-C', writerWork, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', 'feature/ui/add-button']);
    const targetSha = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim();

    const repoPath = 'repos/pullowner/pulldemo/pulls';
    const created = await call('POST', repoPath, {
      title: 'Add feature', description: 'Exercise the server-backed PR flow.',
      sourceBranch: 'feature/ui/add-button', targetBranch: 'main',
    });
    expect(created.status).toBe(201);
    const creation = await responseJson<{ pullRequest: { number: number }; permissions: { canCreate: boolean; canEdit: boolean; canMerge: boolean } }>(created);
    expect(creation).toMatchObject({ permissions: { canCreate: true, canEdit: true, canMerge: true } });
    const number = creation.pullRequest.number;
    expect(number).toBe(1);

    const listed = await call('GET', repoPath);
    expect(listed.status).toBe(200);
    expect((await responseJson<{ pullRequests: unknown[] }>(listed)).pullRequests).toHaveLength(1);

    const detailResponse = await call('GET', `${repoPath}/${number}`);
    expect(detailResponse.status).toBe(200);
    const detail = await responseJson<{ pullRequest: { id: string; number: number; status: string; sourceSha: string; targetSha: string; version: number } }>(detailResponse);
    expect(detail.pullRequest).toMatchObject({ number, status: 'OPEN', sourceSha, targetSha, version: 1 });

    const comparisonResponse = await call('GET', `${repoPath}/${number}/compare`);
    expect(comparisonResponse.status).toBe(200);
    const comparison = await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number;
      stale: boolean; files: { path: string }[]; diff: string }>(comparisonResponse);
    expect(comparison).toMatchObject({ state: 'READY', sourceSha, targetSha, storageGeneration: 0, stale: false });
    expect(comparison.files.map((file: { path: string }) => file.path)).toContain('feature.txt');
    expect(comparison.diff).toContain('button: enabled');

    const summaryResponse = await call('GET', `${repoPath}/${number}/compare?summary=true`);
    expect(summaryResponse.status).toBe(200);
    const summary = await responseJson<Record<string, unknown>>(summaryResponse);
    expect(summary).toMatchObject({ state: 'READY', sourceSha, targetSha, storageGeneration: 0, stale: false });
    expect(summary).not.toHaveProperty('commits');
    expect(summary).not.toHaveProperty('files');
    expect(summary).not.toHaveProperty('diff');

    const pageQuery = new URLSearchParams({ sourceSha, targetSha, storageGeneration: '0', page: '1', pageSize: '20' }).toString();
    const commitsPageResponse = await call('GET', `${repoPath}/${number}/commits?${pageQuery}`, undefined, writerCookie);
    expect(commitsPageResponse.status).toBe(200);
    expect(await responseJson<{ snapshot: { sourceSha: string; targetSha: string; storageGeneration: number };
      pagination: { page: number; pageSize: number; totalItems: number; hasMore: boolean }; commits: { sha: string }[] }>(commitsPageResponse))
      .toMatchObject({ snapshot: { sourceSha, targetSha, storageGeneration: 0 },
        pagination: { page: 1, pageSize: 20, totalItems: 1, hasMore: false }, commits: [{ sha: sourceSha }] });

    const filesPageResponse = await call('GET', `${repoPath}/${number}/files?${pageQuery}`, undefined, writerCookie);
    expect(filesPageResponse.status).toBe(200);
    expect(await responseJson<{ snapshot: { sourceSha: string; targetSha: string; storageGeneration: number };
      files: { path: string; status: string }[] }>(filesPageResponse))
      .toMatchObject({ snapshot: { sourceSha, targetSha, storageGeneration: 0 }, files: [{ path: 'feature.txt', status: 'A' }] });

    const diffPageResponse = await call('GET', `${repoPath}/${number}/diff?${pageQuery}`, undefined, writerCookie);
    expect(diffPageResponse.status).toBe(200);
    const diffPage = await responseJson<{ files: { path: string; diffStatus: string; diff: string }[] }>(diffPageResponse);
    expect(diffPage).toHaveProperty('files');
    expect(diffPage)
      .toMatchObject({ files: [{ path: 'feature.txt', diffStatus: 'TEXT', diff: expect.stringContaining('+button: enabled') }] });

    const outsiderRegistration = await call('POST', 'auth/register', {
      username: 'PullOutsider', email: 'pull-outsider@example.test', password: 'test-password-123',
    }, '');
    expect(outsiderRegistration.status).toBe(201);
    const outsiderCookie = cookie(outsiderRegistration);
    const privateReadPaths = [
      repoPath,
      `${repoPath}/${number}`,
      `${repoPath}/${number}/compare`,
      `${repoPath}/${number}/commits?${pageQuery}`,
      `${repoPath}/${number}/files?${pageQuery}`,
      `${repoPath}/${number}/diff?${pageQuery}`,
    ];
    const privateMarkers = ['Add feature', 'Exercise the server-backed PR flow.', 'feature/ui/add-button',
      sourceSha, targetSha, 'button: enabled'];
    for (const actor of [{ label: 'anonymous', cookies: '' }, { label: 'authenticated non-member', cookies: outsiderCookie }]) {
      for (const path of privateReadPaths) {
        const hiddenResponse = await call('GET', path, undefined, actor.cookies);
        expect(hiddenResponse.status).toBe(404);
        const body = await hiddenResponse.text();
        for (const marker of privateMarkers) expect(body).not.toContain(marker);
      }
    }
    expect((await call('GET', `${repoPath}/${number}/commits?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(pageQuery)), storageGeneration: '1' })}`)).status).toBe(409);
    expect((await call('GET', `${repoPath}/${number}/files?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(pageQuery)), sourceSha: 'c'.repeat(40) })}`)).status).toBe(409);
    expect((await call('GET', `${repoPath}/${number}/diff?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(pageQuery)), pageSize: '101' })}`)).status).toBe(400);
    expect((await call('GET', `${repoPath}/${number}/commits?targetSha=${targetSha}&storageGeneration=0`)).status).toBe(400);

    const unresolvedOperationId = randomUUID();
    const owner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'pullowner' } });
    await db.pullRequestMergeOperation.create({ data: {
      operationId: unresolvedOperationId,
      repositoryId: storedRepo.id,
      pullRequestId: detail.pullRequest.id,
      actorId: owner.id,
      storageGeneration: storedRepo.storageGeneration,
      expectedSourceSha: sourceSha,
      expectedTargetSha: targetSha,
      oldTargetSha: targetSha,
      status: 'NEEDS_RECONCILIATION',
      errorCode: 'TEST_PENDING_RECONCILIATION',
    } });
    try {
      const blockedResponse = await call('POST', `${repoPath}/${number}/merge`, {
        operationId: randomUUID(), expectedSourceSha: sourceSha, expectedTargetSha: targetSha,
        storageGeneration: storedRepo.storageGeneration, version: detail.pullRequest.version,
      });
      expect(blockedResponse.status).toBe(409);
      expect(await responseJson<{ error: { code: string } }>(blockedResponse)).toMatchObject({
        error: { code: 'MERGE_RECONCILIATION_REQUIRED' },
      });
      expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(targetSha);
      expect(await db.auditLog.count({ where: { targetId: detail.pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(0);
    } finally {
      await db.pullRequestMergeOperation.deleteMany({ where: { operationId: unresolvedOperationId } });
    }

    const operationIds = [randomUUID(), randomUUID()] as const;
    expect(operationIds[0]).not.toBe(operationIds[1]);
    const mergeRequest = { expectedSourceSha: sourceSha, expectedTargetSha: targetSha,
      storageGeneration: storedRepo.storageGeneration, version: detail.pullRequest.version };
    const concurrentResponses = await Promise.all([
      call('POST', `${repoPath}/${number}/merge`, { ...mergeRequest, operationId: operationIds[0] }),
      call('POST', `${repoPath}/${number}/merge`, { ...mergeRequest, operationId: operationIds[1] }),
    ]);
    const successfulResponses = concurrentResponses.filter((response) => response.status === 200);
    const rejectedResponses = concurrentResponses.filter((response) => response.status === 409);
    expect(successfulResponses).toHaveLength(1);
    expect(rejectedResponses).toHaveLength(1);
    const mergedResponse = successfulResponses[0]!;
    const rejectedResponse = rejectedResponses[0]!;
    const merged = await responseJson<{ status: string; operationId: string; mergeCommitSha: string }>(mergedResponse);
    const rejected = await responseJson<{ error: { code: string } }>(rejectedResponse);
    // With distinct operation IDs, the serialized loser observes the already-merged PR and gets a 409.
    expect(rejected.error.code).toBe('PULL_REQUEST_NOT_OPEN');
    expect(operationIds).toContain(merged.operationId);
    expect(merged.status).toBe('MERGED');
    expect(merged.mergeCommitSha).toMatch(/^[a-f0-9]{40,64}$/);
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(merged.mergeCommitSha);
    const parents = (await git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', merged.mergeCommitSha])).stdout.trim().split(' ');
    expect(parents).toHaveLength(3);
    expect(parents.slice(1).sort()).toEqual([targetSha, sourceSha].sort());

    const finalDetail = await responseJson<{ pullRequest: { status: string; mergeCommitSha: string };
      mergeOperation: { status: string } }>(await call('GET', `${repoPath}/${number}`));
    expect(finalDetail.pullRequest).toMatchObject({ status: 'MERGED', mergeCommitSha: merged.mergeCommitSha });
    expect(finalDetail.mergeOperation).toMatchObject({ status: 'COMPLETED' });
    const mergeOperations = await db.pullRequestMergeOperation.findMany({ where: { pullRequestId: detail.pullRequest.id } });
    expect(mergeOperations).toHaveLength(1);
    expect(mergeOperations[0]?.operationId).toBe(merged.operationId);
    expect(await db.auditLog.count({ where: { targetId: detail.pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(1);

    await git(['-C', writerWork, 'fetch', 'origin', 'main']);
    expect((await git(['-C', writerWork, 'rev-parse', 'refs/remotes/origin/main'])).stdout.trim()).toBe(merged.mergeCommitSha);
    expect((await git(['-C', writerWork, 'show', 'refs/remotes/origin/main:feature.txt'])).stdout).toBe('button: enabled\n');

    const replay = await call('POST', `${repoPath}/${number}/merge`, {
      operationId: merged.operationId, expectedSourceSha: sourceSha, expectedTargetSha: targetSha,
      storageGeneration: storedRepo.storageGeneration, version: detail.pullRequest.version,
    });
    expect(replay.status).toBe(200);
    expect(await responseJson(replay)).toMatchObject({ status: 'MERGED', mergeCommitSha: merged.mergeCommitSha });
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(merged.mergeCommitSha);
    expect(await db.auditLog.count({ where: { targetId: detail.pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(1);

    // A real Git conflict must fail before target ref movement and leave the PR open.
    await git(['-C', writerWork, 'checkout', '-B', 'main', 'refs/remotes/origin/main']);
    const conflictTargetBranch = 'conflict/target';
    await git(['-C', writerWork, 'checkout', '-b', conflictTargetBranch]);
    await writeFile(join(writerWork, 'merge-conflict.txt'), 'target version\n');
    await git(['-C', writerWork, 'add', 'merge-conflict.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Add target side of merge conflict']);
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', conflictTargetBranch]);
    const conflictTargetSha = (await git(['--git-dir', bare, 'rev-parse', `refs/heads/${conflictTargetBranch}`])).stdout.trim();

    await git(['-C', writerWork, 'checkout', '-b', 'feature/conflict-source', 'main']);
    await writeFile(join(writerWork, 'merge-conflict.txt'), 'source version\n');
    await git(['-C', writerWork, 'add', 'merge-conflict.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Add source side of merge conflict']);
    const conflictSourceSha = (await git(['-C', writerWork, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', 'feature/conflict-source']);

    const conflictCreated = await call('POST', repoPath, {
      title: 'Conflict leaves target unchanged',
      description: 'A real merge-tree conflict must not move the target ref or mark the PR merged.',
      sourceBranch: 'feature/conflict-source', targetBranch: conflictTargetBranch,
    });
    expect(conflictCreated.status).toBe(201);
    const conflictPull = await responseJson<{ pullRequest: { id: string; number: number } }>(conflictCreated);
    const conflictDetailResponse = await call('GET', `${repoPath}/${conflictPull.pullRequest.number}`);
    expect(conflictDetailResponse.status).toBe(200);
    const conflictDetail = await responseJson<{ pullRequest: { version: number; status: string } }>(conflictDetailResponse);
    expect(conflictDetail.pullRequest).toMatchObject({ status: 'OPEN', version: 1 });
    const conflictCompareResponse = await call('GET', `${repoPath}/${conflictPull.pullRequest.number}/compare`);
    expect(conflictCompareResponse.status).toBe(200);
    const conflictCompare = await responseJson<{ state: string; sourceSha: string; targetSha: string;
      storageGeneration: number }>(conflictCompareResponse);
    expect(conflictCompare).toMatchObject({ state: 'READY', sourceSha: conflictSourceSha,
      targetSha: conflictTargetSha, storageGeneration: storedRepo.storageGeneration });

    const conflictOperationId = randomUUID();
    const conflictMergeResponse = await call('POST', `${repoPath}/${conflictPull.pullRequest.number}/merge`, {
      operationId: conflictOperationId, expectedSourceSha: conflictCompare.sourceSha,
      expectedTargetSha: conflictCompare.targetSha, storageGeneration: conflictCompare.storageGeneration,
      version: conflictDetail.pullRequest.version,
    });
    expect(conflictMergeResponse.status).toBe(409);
    expect(await responseJson<{ error: { code: string } }>(conflictMergeResponse))
      .toMatchObject({ error: { code: 'MERGE_CONFLICT' } });
    expect((await git(['--git-dir', bare, 'rev-parse', `refs/heads/${conflictTargetBranch}`])).stdout.trim())
      .toBe(conflictTargetSha);
    const conflictPullAfter = await db.pullRequest.findUniqueOrThrow({ where: { id: conflictPull.pullRequest.id } });
    expect(conflictPullAfter).toMatchObject({ status: 'OPEN', version: conflictDetail.pullRequest.version,
      mergeCommitSha: null, mergedById: null });
    const conflictOperations = await db.pullRequestMergeOperation.findMany({
      where: { pullRequestId: conflictPull.pullRequest.id },
    });
    expect(conflictOperations).toHaveLength(1);
    expect(conflictOperations[0]).toMatchObject({ operationId: conflictOperationId, status: 'FAILED',
      errorCode: 'MERGE_CONFLICT', oldTargetSha: conflictTargetSha, resultingSha: null });
    expect(await db.auditLog.count({ where: { targetId: conflictPull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } }))
      .toBe(0);

    // Exercise the shared repository lock across two different lifecycle mutations.
    await git(['-C', writerWork, 'checkout', '-B', 'main', 'refs/remotes/origin/main']);
    const sameOperationTargetBranch = 'merge/same-operation-target';
    await git(['-C', writerWork, 'checkout', '-b', sameOperationTargetBranch]);
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', sameOperationTargetBranch]);
    await git(['-C', writerWork, 'checkout', '-b', 'feature/same-operation-retry']);
    await writeFile(join(writerWork, 'same-operation.txt'), 'merge exactly once\n');
    await git(['-C', writerWork, 'add', 'same-operation.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Add same-operation test feature']);
    const sameOperationSourceSha = (await git(['-C', writerWork, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', 'feature/same-operation-retry']);
    const sameOperationTargetSha = (await git(['--git-dir', bare, 'rev-parse', `refs/heads/${sameOperationTargetBranch}`])).stdout.trim();
    const sameOperationCreated = await call('POST', repoPath, {
      title: 'Merge same operation ID concurrently',
      description: 'Concurrent retries with one operation ID must share one merge result.',
      sourceBranch: 'feature/same-operation-retry', targetBranch: sameOperationTargetBranch,
    });
    expect(sameOperationCreated.status).toBe(201);
    const sameOperationPull = await responseJson<{ pullRequest: { id: string; number: number } }>(sameOperationCreated);
    const sameOperationDetailResponse = await call('GET', `${repoPath}/${sameOperationPull.pullRequest.number}`);
    expect(sameOperationDetailResponse.status).toBe(200);
    const sameOperationDetail = await responseJson<{ pullRequest: { version: number } }>(sameOperationDetailResponse);
    const sameOperationCompareResponse = await call('GET', `${repoPath}/${sameOperationPull.pullRequest.number}/compare`);
    expect(sameOperationCompareResponse.status).toBe(200);
    const sameOperationCompare = await responseJson<{ state: string; sourceSha: string; targetSha: string;
      storageGeneration: number }>(sameOperationCompareResponse);
    expect(sameOperationCompare).toMatchObject({ state: 'READY', sourceSha: sameOperationSourceSha,
      targetSha: sameOperationTargetSha, storageGeneration: storedRepo.storageGeneration });

    const sameOperationId = randomUUID();
    const sameOperationRequest = { operationId: sameOperationId, expectedSourceSha: sameOperationCompare.sourceSha,
      expectedTargetSha: sameOperationCompare.targetSha, storageGeneration: sameOperationCompare.storageGeneration,
      version: sameOperationDetail.pullRequest.version };
    const sameOperationResponses = await Promise.all([
      call('POST', `${repoPath}/${sameOperationPull.pullRequest.number}/merge`, sameOperationRequest),
      call('POST', `${repoPath}/${sameOperationPull.pullRequest.number}/merge`, sameOperationRequest),
    ]);
    expect(sameOperationResponses.map((response) => response.status)).toEqual([200, 200]);
    const sameOperationResults = await Promise.all(sameOperationResponses.map((response) =>
      responseJson<{ status: string; operationId: string; mergeCommitSha: string }>(response)));
    expect(sameOperationResults[0]).toMatchObject({ status: 'MERGED', operationId: sameOperationId });
    expect(sameOperationResults[1]).toEqual(sameOperationResults[0]);
    const sameOperationMergeSha = sameOperationResults[0]!.mergeCommitSha;
    expect(sameOperationMergeSha).not.toBe(sameOperationTargetSha);
    expect((await git(['--git-dir', bare, 'rev-parse', `refs/heads/${sameOperationTargetBranch}`])).stdout.trim())
      .toBe(sameOperationMergeSha);
    const sameOperationParents = (await git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', sameOperationMergeSha]))
      .stdout.trim().split(' ');
    expect(sameOperationParents).toHaveLength(3);
    expect(sameOperationParents.slice(1).sort()).toEqual([sameOperationTargetSha, sameOperationSourceSha].sort());
    const sameOperationRows = await db.pullRequestMergeOperation.findMany({
      where: { pullRequestId: sameOperationPull.pullRequest.id },
    });
    expect(sameOperationRows).toHaveLength(1);
    expect(sameOperationRows[0]).toMatchObject({ operationId: sameOperationId, status: 'COMPLETED',
      resultingSha: sameOperationMergeSha });
    expect(await db.auditLog.count({ where: { targetId: sameOperationPull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } }))
      .toBe(1);

    await git(['-C', writerWork, 'fetch', 'origin', 'main']);
    await git(['-C', writerWork, 'checkout', '-B', 'main', 'refs/remotes/origin/main']);
    await git(['-C', writerWork, 'checkout', '-b', 'feature/delete-race']);
    await writeFile(join(writerWork, 'delete-race.txt'), 'second feature\n');
    await git(['-C', writerWork, 'add', 'delete-race.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Add feature for merge-delete race']);
    const raceSourceSha = (await git(['-C', writerWork, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', 'feature/delete-race']);
    const raceCreated = await call('POST', repoPath, {
      title: 'Race merge against repository deletion',
      description: 'Verify merge and soft-delete serialize on the repository lock.',
      sourceBranch: 'feature/delete-race', targetBranch: 'main',
    });
    expect(raceCreated.status).toBe(201);
    const racePullRequest = await responseJson<{ pullRequest: { id: string; number: number } }>(raceCreated);
    const raceDetailResponse = await call('GET', `${repoPath}/${racePullRequest.pullRequest.number}`);
    expect(raceDetailResponse.status).toBe(200);
    const raceDetail = await responseJson<{ pullRequest: { version: number; status: string } }>(raceDetailResponse);
    expect(raceDetail.pullRequest.status).toBe('OPEN');
    const raceComparisonResponse = await call('GET', `${repoPath}/${racePullRequest.pullRequest.number}/compare`);
    expect(raceComparisonResponse.status).toBe(200);
    const raceComparison = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number;
      state: string; stale: boolean }>(raceComparisonResponse);
    expect(raceComparison).toMatchObject({ sourceSha: raceSourceSha, targetSha: merged.mergeCommitSha,
      storageGeneration: storedRepo.storageGeneration, state: 'READY', stale: false });

    const raceOperationId = randomUUID();
    const [raceMergeResponse, deleteResponse] = await Promise.all([
      call('POST', `${repoPath}/${racePullRequest.pullRequest.number}/merge`, {
        operationId: raceOperationId, expectedSourceSha: raceComparison.sourceSha,
        expectedTargetSha: raceComparison.targetSha, storageGeneration: raceComparison.storageGeneration,
        version: raceDetail.pullRequest.version,
      }),
      call('DELETE', 'repos/pullowner/pulldemo'),
    ]);
    expect(deleteResponse.status).toBe(204);
    expect([200, 403, 404]).toContain(raceMergeResponse.status);

    const deletedRepository = await db.repository.findUniqueOrThrow({ where: { id: storedRepo.id } });
    expect(deletedRepository.status).toBe('DELETED');
    expect(await db.auditLog.count({ where: { targetId: storedRepo.id, action: 'REPOSITORY_SOFT_DELETED' } })).toBe(1);
    const finalRaceTargetSha = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim();
    const raceDbPullRequest = await db.pullRequest.findUniqueOrThrow({ where: { id: racePullRequest.pullRequest.id } });
    const raceMergeOperations = await db.pullRequestMergeOperation.findMany({
      where: { pullRequestId: racePullRequest.pullRequest.id },
    });
    const raceMergeAudits = await db.auditLog.count({
      where: { targetId: racePullRequest.pullRequest.id, action: 'PULL_REQUEST_MERGED' },
    });

    if (raceMergeResponse.status === 200) {
      const raceMerged = await responseJson<{ status: string; operationId: string; mergeCommitSha: string }>(raceMergeResponse);
      expect(raceMerged).toMatchObject({ status: 'MERGED', operationId: raceOperationId });
      expect(raceMerged.mergeCommitSha).toMatch(/^[a-f0-9]{40,64}$/);
      expect(finalRaceTargetSha).toBe(raceMerged.mergeCommitSha);
      const raceParents = (await git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', raceMerged.mergeCommitSha]))
        .stdout.trim().split(' ');
      expect(raceParents).toHaveLength(3);
      expect(raceParents.slice(1).sort()).toEqual([raceComparison.targetSha, raceComparison.sourceSha].sort());
      expect(raceDbPullRequest).toMatchObject({ status: 'MERGED', mergeCommitSha: raceMerged.mergeCommitSha });
      expect(raceMergeOperations).toHaveLength(1);
      expect(raceMergeOperations[0]).toMatchObject({ operationId: raceOperationId, status: 'COMPLETED',
        resultingSha: raceMerged.mergeCommitSha });
      expect(raceMergeAudits).toBe(1);
    } else {
      expect(finalRaceTargetSha).toBe(raceComparison.targetSha);
      expect(raceDbPullRequest).toMatchObject({ status: 'OPEN', mergeCommitSha: null });
      expect(raceMergeOperations).toHaveLength(0);
      expect(raceMergeAudits).toBe(0);
    }
  }, 60_000);

  it('rejects a merge over repository quota without moving refs or merging metadata, while an in-quota merge preserves both parents', async () => {
    const createdRepo = await call('POST', 'repositories', {
      name: 'MergeQuota', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);
    const work = join(storageRoot, 'merge-quota-clone');
    const git = (args: string[], input?: string) => execFileSync('git', args, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input,
    }).trim();
    const logicalObjectBytes = () => {
      const ids = git(['--git-dir', bare, 'rev-list', '--objects', '--all'])
        .split('\n').filter(Boolean).map((line) => line.split(' ')[0]!);
      const sizes = git(['--git-dir', bare, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
        `${ids.join('\n')}\n`);
      return sizes.split('\n').filter(Boolean).reduce((sum, line) => sum + Number(line.split(' ')[2]), 0);
    };
    const publishBranch = (branch: string, sha: string) => {
      git(['--git-dir', bare, 'fetch', work, sha]);
      git(['--git-dir', bare, 'update-ref', `refs/heads/${branch}`, sha]);
    };
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Quota Owner']);
    git(['-C', work, 'config', 'user.email', 'quota-owner@example.test']);
    const repoPath = 'repos/pullowner/mergequota/pulls';
    const configuration = app.get(ConfigService);
    const originalMaxFileBytes = configuration.getOrThrow<number>('MAX_FILE_BYTES');
    const originalMaxRepositoryBytes = configuration.getOrThrow<number>('MAX_REPOSITORY_BYTES');

    try {
      configuration.set('MAX_FILE_BYTES', 100);
      configuration.set('MAX_REPOSITORY_BYTES', 1_000_000);

      await git(['-C', work, 'switch', '-c', 'feature/within-quota']);
      await writeFile(join(work, 'within.txt'), 'small in-quota content\n');
      git(['-C', work, 'add', 'within.txt']);
      git(['-C', work, 'commit', '-m', 'Add in-quota content']);
      const withinSourceSha = git(['-C', work, 'rev-parse', 'HEAD']);
      publishBranch('feature/within-quota', withinSourceSha);
      const withinCreated = await call('POST', repoPath, {
        title: 'Within repository quota', description: 'A merge below the configured quota.',
        sourceBranch: 'feature/within-quota', targetBranch: 'main',
      });
      expect(withinCreated.status).toBe(201);
      const withinPull = await responseJson<{ pullRequest: { id: string; number: number } }>(withinCreated);
      const withinDetailResponse = await call('GET', `${repoPath}/${withinPull.pullRequest.number}`);
      const withinDetail = await responseJson<{ pullRequest: { version: number } }>(withinDetailResponse);
      const withinCompareResponse = await call('GET', `${repoPath}/${withinPull.pullRequest.number}/compare`);
      const withinCompare = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(withinCompareResponse);
      expect(withinDetailResponse.status).toBe(200);
      expect(withinCompareResponse.status).toBe(200);
      expect(withinCompare.sourceSha).toBe(withinSourceSha);
      const withinOperationId = randomUUID();
      const withinMergeResponse = await call('POST', `${repoPath}/${withinPull.pullRequest.number}/merge`, {
        operationId: withinOperationId, expectedSourceSha: withinCompare.sourceSha,
        expectedTargetSha: withinCompare.targetSha, storageGeneration: withinCompare.storageGeneration,
        version: withinDetail.pullRequest.version,
      });
      expect(withinMergeResponse.status).toBe(200);
      const withinMerge = await responseJson<{ status: string; mergeCommitSha: string }>(withinMergeResponse);
      const withinParents = git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', withinMerge.mergeCommitSha]).split(' ');
      expect(withinMerge.status).toBe('MERGED');
      expect(withinParents).toHaveLength(3);
      expect(withinParents.slice(1).sort()).toEqual([withinCompare.targetSha, withinSourceSha].sort());
      expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).toBe(withinMerge.mergeCommitSha);

      git(['-C', work, 'fetch', 'origin', 'main']);
      git(['-C', work, 'switch', '-c', 'feature/over-file-quota']);
      await writeFile(join(work, 'large.txt'), 'x'.repeat(101));
      git(['-C', work, 'add', 'large.txt']);
      git(['-C', work, 'commit', '-m', 'Add over-file-quota candidate']);
      const largeFileSourceSha = git(['-C', work, 'rev-parse', 'HEAD']);
      publishBranch('feature/over-file-quota', largeFileSourceSha);
      const largeFileCreated = await call('POST', repoPath, {
        title: 'Over file quota', description: 'A merge with a blob above the configured file limit.',
        sourceBranch: 'feature/over-file-quota', targetBranch: 'main',
      });
      expect(largeFileCreated.status).toBe(201);
      const largeFilePull = await responseJson<{ pullRequest: { id: string; number: number } }>(largeFileCreated);
      const largeFileDetailResponse = await call('GET', `${repoPath}/${largeFilePull.pullRequest.number}`);
      const largeFileDetail = await responseJson<{ pullRequest: { version: number } }>(largeFileDetailResponse);
      const largeFileCompareResponse = await call('GET', `${repoPath}/${largeFilePull.pullRequest.number}/compare`);
      const largeFileCompare = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(largeFileCompareResponse);
      expect(largeFileDetailResponse.status).toBe(200);
      expect(largeFileCompareResponse.status).toBe(200);
      expect(largeFileCompare.sourceSha).toBe(largeFileSourceSha);

      const refsBeforeFileQuotaMerge = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)']);
      const fileQuotaAuditsBefore = await db.auditLog.count({ where: { targetId: largeFilePull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } });
      const fileQuotaOperationId = randomUUID();
      const fileQuotaResponse = await call('POST', `${repoPath}/${largeFilePull.pullRequest.number}/merge`, {
        operationId: fileQuotaOperationId, expectedSourceSha: largeFileCompare.sourceSha,
        expectedTargetSha: largeFileCompare.targetSha, storageGeneration: largeFileCompare.storageGeneration,
        version: largeFileDetail.pullRequest.version,
      });
      expect(fileQuotaResponse.status).toBe(409);
      expect(await responseJson<{ error: { code: string } }>(fileQuotaResponse)).toMatchObject({
        error: { code: 'MERGE_FILE_QUOTA_EXCEEDED' },
      });
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)']))
        .toBe(refsBeforeFileQuotaMerge);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: largeFilePull.pullRequest.id } }))
        .toMatchObject({ status: 'OPEN', version: largeFileDetail.pullRequest.version, mergeCommitSha: null, mergedById: null });
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId: fileQuotaOperationId } }))
        .toMatchObject({ status: 'FAILED', errorCode: 'MERGE_FILE_QUOTA_EXCEEDED',
          oldTargetSha: largeFileCompare.targetSha, resultingSha: null });
      expect(await db.auditLog.count({ where: { targetId: largeFilePull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } }))
        .toBe(fileQuotaAuditsBefore);

      // Remove this deliberately-invalid fixture branch before the aggregate
      // quota case: merge quota walks all reachable refs, not just the target.
      git(['--git-dir', bare, 'update-ref', '-d', 'refs/heads/feature/over-file-quota']);
      git(['-C', work, 'switch', '-C', 'main', 'refs/remotes/origin/main']);
      git(['-C', work, 'switch', '-c', 'feature/over-quota']);
      await writeFile(join(work, 'over.txt'), 'small over-quota content\n');
      git(['-C', work, 'add', 'over.txt']);
      git(['-C', work, 'commit', '-m', 'Add over-quota candidate']);
      const overSourceSha = git(['-C', work, 'rev-parse', 'HEAD']);
      publishBranch('feature/over-quota', overSourceSha);
      const overCreated = await call('POST', repoPath, {
        title: 'Over repository quota', description: 'A merge whose new commit exceeds remaining quota.',
        sourceBranch: 'feature/over-quota', targetBranch: 'main',
      });
      expect(overCreated.status).toBe(201);
      const overPull = await responseJson<{ pullRequest: { id: string; number: number } }>(overCreated);
      const overDetailResponse = await call('GET', `${repoPath}/${overPull.pullRequest.number}`);
      const overDetail = await responseJson<{ pullRequest: { version: number; status: string } }>(overDetailResponse);
      const overCompareResponse = await call('GET', `${repoPath}/${overPull.pullRequest.number}/compare`);
      const overCompare = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(overCompareResponse);
      expect(overDetailResponse.status).toBe(200);
      expect(overCompareResponse.status).toBe(200);
      expect(overCompare.sourceSha).toBe(overSourceSha);

      const baselineBytes = logicalObjectBytes();
      expect(baselineBytes).toBeGreaterThan(100);
      configuration.set('MAX_REPOSITORY_BYTES', baselineBytes);
      const refsBefore = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)']);
      const auditsBefore = await db.auditLog.count({ where: { targetId: overPull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } });
      const operationId = randomUUID();
      const rejectedResponse = await call('POST', `${repoPath}/${overPull.pullRequest.number}/merge`, {
        operationId, expectedSourceSha: overCompare.sourceSha, expectedTargetSha: overCompare.targetSha,
        storageGeneration: overCompare.storageGeneration, version: overDetail.pullRequest.version,
      });
      expect(rejectedResponse.status).toBe(409);
      expect(await responseJson<{ error: { code: string } }>(rejectedResponse)).toMatchObject({
        error: { code: 'MERGE_REPOSITORY_QUOTA_EXCEEDED' },
      });
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)']))
        .toBe(refsBefore);
      const overPullAfter = await db.pullRequest.findUniqueOrThrow({ where: { id: overPull.pullRequest.id } });
      expect(overPullAfter).toMatchObject({ status: 'OPEN', version: overDetail.pullRequest.version,
        mergeCommitSha: null, mergedById: null });
      const failedOperation = await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } });
      expect(failedOperation).toMatchObject({ status: 'FAILED', errorCode: 'MERGE_REPOSITORY_QUOTA_EXCEEDED',
        oldTargetSha: overCompare.targetSha, resultingSha: null });
      expect(await db.auditLog.count({ where: { targetId: overPull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } }))
        .toBe(auditsBefore);
    } finally {
      configuration.set('MAX_FILE_BYTES', originalMaxFileBytes);
      configuration.set('MAX_REPOSITORY_BYTES', originalMaxRepositoryBytes);
    }
  }, 60_000);

  it('reconciles a Git-updated merge after PostgreSQL rejects metadata and preserves the merger', async () => {
    const registered = await call('POST', 'auth/register', {
      username: 'RecoveryOwner', email: 'recovery-owner@example.test', password: 'test-password-123',
    });
    expect(registered.status).toBe(201);
    const recoveryCookie = cookie(registered);
    const createdRepo = await call('POST', 'repositories', {
      name: 'MergeRecovery', visibility: 'PRIVATE', initializeReadme: true,
    }, recoveryCookie);
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);
    const work = join(storageRoot, 'merge-recovery-clone');
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Recovery Owner']);
    git(['-C', work, 'config', 'user.email', 'recovery-owner@example.test']);
    git(['-C', work, 'switch', '-c', 'release/recovery-target']);
    git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/release/recovery-target']);
    git(['-C', work, 'switch', 'main']);
    git(['-C', work, 'switch', '-c', 'feature/recovery']);
    await writeFile(join(work, 'recovered.txt'), 'recovered merge content\n');
    git(['-C', work, 'add', 'recovered.txt']);
    git(['-C', work, 'commit', '-m', 'Add recovery fixture']);
    const sourceSha = git(['-C', work, 'rev-parse', 'HEAD']).trim();
    git(['-C', work, 'push', 'origin', 'feature/recovery']);
    const targetSha = git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/recovery-target']).trim();
    const tokenResponse = await call('POST', 'tokens', {
      name: 'Merge recovery E2E', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, recoveryCookie);
    expect(tokenResponse.status).toBe(201);
    const token = await responseJson<{ token: { id: string }; secret: string }>(tokenResponse);
    const askpass = join(storageRoot, 'merge-recovery-askpass.sh');
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
      { mode: 0o700 });
    const runGit = promisify(execFile);
    const gitHttp = (args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'RecoveryOwner', TEST_GIT_PAT: token.secret },
    });

    const repoPath = 'repos/recoveryowner/mergerecovery/pulls';
    const createdPull = await call('POST', repoPath, {
      title: 'Recover merge metadata', description: 'Verify Git and PostgreSQL reconciliation.',
      sourceBranch: 'feature/recovery', targetBranch: 'release/recovery-target',
    }, recoveryCookie);
    expect(createdPull.status).toBe(201);
    const { pullRequest } = await responseJson<{ pullRequest: { id: string; number: number } }>(createdPull);
    const detailResponse = await call('GET', `${repoPath}/${pullRequest.number}`, undefined, recoveryCookie);
    const detail = await responseJson<{ pullRequest: { version: number }; }>(detailResponse);
    expect(detailResponse.status).toBe(200);
    const compareResponse = await call('GET', `${repoPath}/${pullRequest.number}/compare`, undefined, recoveryCookie);
    const comparison = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(compareResponse);
    expect(compareResponse.status).toBe(200);

    const triggerName = `fail_merge_${schema.slice(-12)}`;
    const functionName = `${triggerName}_fn`;
    await admin.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${pullRequest.id}' AND NEW.status = 'MERGED' THEN
          RAISE EXCEPTION 'intentional isolated merge metadata failure';
        END IF;
        RETURN NEW;
      END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "${schema}"."pull_requests"
      FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);
    const operationId = randomUUID();
    let candidateSha = '';
    try {
      const mergeResponse = await call('POST', `${repoPath}/${pullRequest.number}/merge`, {
        operationId, expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: detail.pullRequest.version,
      }, recoveryCookie);
      expect(mergeResponse.status).toBe(202);
      expect(await responseJson(mergeResponse)).toMatchObject({ status: 'RECONCILING', operationId });

      candidateSha = git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/recovery-target']).trim();
      expect(candidateSha).not.toBe(targetSha);
      const parents = git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', candidateSha]).trim().split(' ');
      expect(parents).toHaveLength(3);
      expect(parents.slice(1).sort()).toEqual([targetSha, sourceSha].sort());
      const pending = await call('GET', `${repoPath}/${pullRequest.number}`, undefined, recoveryCookie);
      expect(await responseJson<{ pullRequest: { status: string; mergedById: string | null };
        mergeOperation: { status: string } }>(pending)).toMatchObject({
        pullRequest: { status: 'OPEN', mergedById: null }, mergeOperation: { status: 'NEEDS_RECONCILIATION' },
      });
      expect(await db.auditLog.count({ where: { targetId: pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(0);

      // Make a valid fast-forward from the newly moved non-default target, then prove the
      // unresolved merge journal fences it before receive-pack can update the ref.
      await gitHttp(['-C', work, 'remote', 'set-url', 'origin', `${base}/git/RecoveryOwner/MergeRecovery.git`]);
      git(['-C', work, 'fetch', bare, 'refs/heads/release/recovery-target']);
      git(['-C', work, 'switch', '--detach', 'FETCH_HEAD']);
      git(['-C', work, 'switch', '-c', 'feature/blocked-unresolved-merge']);
      await writeFile(join(work, 'blocked-push.txt'), 'must not reach the target before reconciliation\n');
      git(['-C', work, 'add', 'blocked-push.txt']);
      git(['-C', work, 'commit', '-m', 'Attempt write during merge reconciliation']);
      await expect(gitHttp(['-C', work, 'push', 'origin', 'HEAD:refs/heads/release/recovery-target'])).rejects.toThrow();
      expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/recovery-target']).trim()).toBe(candidateSha);
      expect(await db.gitPushOperation.count({ where: { repositoryId: storedRepo.id, status: 'COMPLETED' } })).toBe(0);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."pull_requests"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`);
    }

    const maintenance = app.get(MaintenanceJobsService);
    let recovered = false;
    let recoveredDetailResponse: Response | undefined;
    type RecoveredPullRequestDetail = {
      pullRequest: { status: string; mergedById: string | null; mergeCommitSha: string | null };
      mergeOperation: { operationId: string; status: string; errorCode: string | null } | null;
    };
    let recoveredDetail: RecoveredPullRequestDetail | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await maintenance.runOnce();
      recoveredDetailResponse = await call('GET', `${repoPath}/${pullRequest.number}`, undefined, recoveryCookie);
      const current = await responseJson<RecoveredPullRequestDetail>(recoveredDetailResponse);
      recoveredDetail = current;
      if (current.pullRequest.status === 'MERGED') { recovered = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(recovered).toBe(true);

    expect(recoveredDetailResponse?.status).toBe(200);
    const recoveryOwner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'recoveryowner' } });
    expect(recoveredDetail).toMatchObject({
      pullRequest: { status: 'MERGED', mergedById: recoveryOwner.id, mergeCommitSha: candidateSha },
      mergeOperation: { operationId, status: 'COMPLETED' },
    });
    const recoveredOperation = await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } });
    expect(recoveredOperation).toMatchObject({ status: 'COMPLETED', resultingSha: candidateSha, actorId: recoveryOwner.id });
    expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/recovery-target']).trim()).toBe(candidateSha);
    expect(await db.auditLog.count({ where: { targetId: pullRequest.id, action: 'PULL_REQUEST_MERGE_RECONCILED' } })).toBe(1);

    await gitHttp(['-C', work, 'push', 'origin', 'HEAD:refs/heads/release/recovery-target']);
    expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/recovery-target']).trim())
      .toBe(git(['-C', work, 'rev-parse', 'HEAD']).trim());
    expect(await db.gitPushOperation.count({ where: { repositoryId: storedRepo.id, status: 'COMPLETED' } })).toBe(1);

    const retry = await call('POST', `${repoPath}/${pullRequest.number}/merge`, {
      operationId, expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
      storageGeneration: comparison.storageGeneration, version: detail.pullRequest.version,
    }, recoveryCookie);
    expect(retry.status).toBe(200);
    expect(await responseJson(retry)).toMatchObject({ status: 'MERGED', operationId, mergeCommitSha: candidateSha });
    expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/recovery-target']).trim())
      .toBe(git(['-C', work, 'rev-parse', 'HEAD']).trim());
    expect(await db.auditLog.count({ where: { targetId: pullRequest.id, action: 'PULL_REQUEST_MERGE_RECONCILED' } })).toBe(1);

    const fetched = join(storageRoot, 'merge-recovery-fetch');
    git(['clone', '--branch', 'release/recovery-target', bare, fetched]);
    expect(git(['-C', fetched, 'show', 'HEAD:recovered.txt'])).toBe('recovered merge content\n');
  }, 60_000);

  const processCrashTest = process.platform === 'win32' ? it.skip : it;
  processCrashTest('keeps a pre-CAS merge pending during the grace period, then fails it without moving refs', async () => {
    const registration = await call('POST', 'auth/register', {
      username: 'BeforeCasOwner', email: 'before-cas-owner@example.test', password: 'test-password-123',
    });
    expect(registration.status).toBe(201);
    const ownerCookieForTest = cookie(registration);
    const createdRepo = await call('POST', 'repositories', {
      name: 'MergeBeforeCasCrash', visibility: 'PRIVATE', initializeReadme: true,
    }, ownerCookieForTest);
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);
    const work = join(storageRoot, 'merge-before-cas-clone');
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Before CAS Owner']);
    git(['-C', work, 'config', 'user.email', 'before-cas-owner@example.test']);
    git(['-C', work, 'switch', '-c', 'release/before-cas-target']);
    await writeFile(join(work, 'target.txt'), 'target branch fixture\n');
    git(['-C', work, 'add', 'target.txt']);
    git(['-C', work, 'commit', '-m', 'Create before-CAS target']);
    git(['-C', work, 'push', '--set-upstream', 'origin', 'release/before-cas-target']);
    git(['-C', work, 'switch', 'main']);
    git(['-C', work, 'switch', '-c', 'feature/before-cas-source']);
    await writeFile(join(work, 'source.txt'), 'source branch fixture\n');
    git(['-C', work, 'add', 'source.txt']);
    git(['-C', work, 'commit', '-m', 'Create before-CAS source']);
    const sourceSha = git(['-C', work, 'rev-parse', 'HEAD']).trim();
    git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/before-cas-source']);
    const targetSha = git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/before-cas-target']).trim();
    const refsBefore = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']);
    const repoPath = 'repos/beforecasowner/mergebeforecascrash/pulls';
    const createdPull = await call('POST', repoPath, {
      title: 'Recover pre-CAS process death', description: 'Keep a young unchanged-ref journal pending.',
      sourceBranch: 'feature/before-cas-source', targetBranch: 'release/before-cas-target',
    }, ownerCookieForTest);
    expect(createdPull.status).toBe(201);
    const { pullRequest } = await responseJson<{ pullRequest: { id: string; number: number } }>(createdPull);
    const detailResponse = await call('GET', `${repoPath}/${pullRequest.number}`, undefined, ownerCookieForTest);
    const detail = await responseJson<{ pullRequest: { version: number } }>(detailResponse);
    expect(detailResponse.status).toBe(200);
    const compareResponse = await call('GET', `${repoPath}/${pullRequest.number}/compare`, undefined, ownerCookieForTest);
    const comparison = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(compareResponse);
    expect(compareResponse.status).toBe(200);
    expect(comparison).toMatchObject({ sourceSha, targetSha });

    const triggerName = `pause_before_cas_${schema.slice(-12)}`;
    const functionName = `${triggerName}_fn`;
    const operationId = randomUUID();
    const childApplicationName = `merge-before-cas-${schema.slice(-12)}`;
    const firstRecoveryName = `merge-before-cas-young-${schema.slice(-12)}`;
    const secondRecoveryName = `merge-before-cas-aged-${schema.slice(-12)}`;
    const barrierKey = `merge-before-cas-barrier-${schema.slice(-12)}`;
    const startedApiProcesses: Array<{ applicationName: string; process: ChildProcessWithoutNullStreams }> = [];
    const backendRoot = resolve(__dirname, '..');
    const childScript = `
      require('reflect-metadata');
      const { NestFactory } = require('@nestjs/core');
      const { ValidationPipe } = require('@nestjs/common');
      const cookieParser = require('cookie-parser');
      (async () => {
        const { AppModule } = require(process.env.CODE_FORGE_TEST_APP_MODULE);
        const { MaintenanceJobsService } = require(process.env.CODE_FORGE_TEST_MAINTENANCE_SERVICE);
        const app = await NestFactory.create(AppModule, { logger: false });
        app.use(cookieParser());
        app.setGlobalPrefix('api/v1');
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        let controlBuffer = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          controlBuffer += chunk;
          while (controlBuffer.includes('\\n')) {
            const newline = controlBuffer.indexOf('\\n');
            const command = controlBuffer.slice(0, newline).trim();
            controlBuffer = controlBuffer.slice(newline + 1);
            if (command === 'RUN_MAINTENANCE') {
              app.get(MaintenanceJobsService).runOnce().then(
                () => process.stdout.write('CODE_FORGE_MAINTENANCE_COMPLETE\\n'),
                () => process.stdout.write('CODE_FORGE_MAINTENANCE_FAILED\\n'),
              );
            }
          }
        });
        await app.listen(0, '127.0.0.1');
        process.stdout.write('CODE_FORGE_TEST_READY:' + await app.getUrl() + '\\n');
      })().catch(() => process.exit(2));
    `;
    const startApi = async (applicationName: string) => {
      const databaseUrl = new URL(process.env.DATABASE_URL!);
      databaseUrl.searchParams.set('application_name', applicationName);
      const apiProcess = spawn(process.execPath, ['-r', requireFromBackend.resolve('ts-node/register'), '-e', childScript], {
        detached: true,
        cwd: backendRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl.toString(), DATABASE_URL_UNPOOLED: databaseUrl.toString(),
          GIT_STORAGE_PATH: storageRoot, CODE_FORGE_TEST_APP_MODULE: join(backendRoot, 'src', 'app.module.ts'),
          CODE_FORGE_TEST_MAINTENANCE_SERVICE: join(backendRoot, 'src', 'maintenance', 'maintenance-jobs.service.ts') },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      startedApiProcesses.push({ applicationName, process: apiProcess });
      let output = '';
      let errorOutput = '';
      let ready = false;
      apiProcess.stdout.setEncoding('utf8');
      apiProcess.stderr.setEncoding('utf8');
      apiProcess.stderr.on('data', (chunk: string) => { errorOutput += chunk; });
      try {
        const apiBase = await new Promise<string>((resolveReady, rejectReady) => {
          const timeout = setTimeout(() => rejectReady(new Error('Child API did not become ready.')), 12_000);
          apiProcess.stdout.on('data', (chunk: string) => {
            output += chunk;
            const match = output.match(/CODE_FORGE_TEST_READY:(http:\/\/127\.0\.0\.1:\d+)/);
            if (match) { ready = true; clearTimeout(timeout); resolveReady(`${match[1]}/api/v1`); }
          });
          apiProcess.on('error', (error) => {
            if (!ready) { clearTimeout(timeout); rejectReady(error); }
          });
          apiProcess.once('exit', () => {
            clearTimeout(timeout);
            if (!ready) rejectReady(new Error('Child API exited before becoming ready.'));
          });
        });
        const runMaintenance = () => new Promise<void>((resolveMaintenance, rejectMaintenance) => {
          let markerOutput = '';
          const cleanup = () => {
            clearTimeout(timeout);
            apiProcess.stdout.removeListener('data', onData);
            apiProcess.removeListener('exit', onExit);
          };
          const onData = (chunk: string) => {
            markerOutput += chunk;
            if (markerOutput.includes('CODE_FORGE_MAINTENANCE_COMPLETE')) {
              cleanup();
              resolveMaintenance();
            } else if (markerOutput.includes('CODE_FORGE_MAINTENANCE_FAILED')) {
              cleanup();
              rejectMaintenance(new Error('Child maintenance run failed.'));
            }
          };
          const onExit = () => {
            cleanup();
            rejectMaintenance(new Error('Child API exited before maintenance completed.'));
          };
          const timeout = setTimeout(() => {
            cleanup();
            rejectMaintenance(new Error('Child maintenance run did not complete within 30 seconds.'));
          }, 30_000);
          apiProcess.stdout.on('data', onData);
          apiProcess.once('exit', onExit);
          apiProcess.stdin.write('RUN_MAINTENANCE\n');
        });
        return { process: apiProcess, base: apiBase, runMaintenance };
      } catch (error) {
        if (apiProcess.pid && apiProcess.exitCode === null && apiProcess.signalCode === null) {
          const exited = new Promise<void>((resolveExit) => apiProcess.once('close', () => resolveExit()));
          killChildProcessTree(apiProcess);
          await exited;
        }
        throw new Error(`Child API failed to start. ${errorOutput.slice(-2000)}`, { cause: error });
      }
    };
    const stopApi = async (apiProcess: ChildProcessWithoutNullStreams | undefined) => {
      if (!apiProcess || apiProcess.exitCode !== null || apiProcess.signalCode !== null) return;
      const closed = new Promise<void>((resolveClosed, rejectClosed) => {
        const timeout = setTimeout(() => rejectClosed(new Error('Child API cleanup timed out.')), 5_000);
        apiProcess.once('close', () => { clearTimeout(timeout); resolveClosed(); });
      });
      killChildProcessTree(apiProcess);
      await closed;
    };
    let barrier: Client | undefined;
    const waitForSessionsToExit = async (applicationName: string, timeoutMs: number) => {
      if (!barrier) throw new Error('Crash-recovery barrier client is not connected.');
      const deadline = Date.now() + timeoutMs;
      let sessions: Array<{ pid: number }> = [];
      while (Date.now() < deadline) {
        sessions = (await barrier.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
          WHERE application_name = $1 AND datname = current_database() AND pid <> pg_backend_pid()`, [applicationName])).rows;
        if (sessions.length === 0) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      throw new Error(`PostgreSQL sessions for ${applicationName} did not exit after cleanup.`);
    };
    const terminateApiSessions = async (applicationName: string) => {
      if (!barrier) throw new Error('Crash-recovery barrier client is not connected.');
      const sessions = await barrier.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
        WHERE application_name = $1 AND datname = current_database() AND pid <> pg_backend_pid()`, [applicationName]);
      for (const session of sessions.rows) {
        await barrier.query('SELECT pg_terminate_backend($1)', [session.pid]);
      }
    };
    const mergeJournalTable = `"${schema}"."pull_request_merge_operations"`;
    const waitForMergeReconciliationQueryToFinish = async (pid: number, timeoutMs: number) => {
      if (!barrier) throw new Error('Crash-recovery barrier client is not connected.');
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = await barrier.query<{ holdsLock: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity AS activity
          JOIN pg_locks AS lock ON lock.pid = activity.pid
          WHERE activity.pid = $1 AND activity.datname = current_database()
            AND activity.pid <> pg_backend_pid()
            AND lock.locktype = 'relation' AND lock.relation = to_regclass($2)
            AND lock.mode = 'AccessShareLock' AND lock.granted
        ) AS "holdsLock"`, [pid, mergeJournalTable]);
        if (!result.rows[0]?.holdsLock) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      const snapshot = await barrier.query<{ pid: number; state: string; waitEventType: string | null; waitEvent: string | null; query: string }>(`
        SELECT activity.pid, activity.state, activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent",
          LEFT(regexp_replace(regexp_replace(activity.query, $$'([^']|'')*'$$, '[redacted]', 'g'),
            '[0-9a-fA-F]{32,}', '[redacted]', 'g'), 180) AS query
        FROM pg_stat_activity AS activity
        JOIN pg_locks AS lock ON lock.pid = activity.pid
        WHERE activity.pid = $1 AND activity.datname = current_database()
          AND lock.locktype = 'relation' AND lock.relation = to_regclass($2)
          AND lock.mode = 'AccessShareLock'
        LIMIT 1`, [pid, mergeJournalTable]);
      throw new Error(`Maintenance PID ${pid} still holds the merge-table lock after the barrier; snapshot: ${JSON.stringify(snapshot.rows)}.`);
    };
    const waitForMergeReconciliationWaiter = async (applicationName: string, timeoutMs: number): Promise<number> => {
      if (!barrier) throw new Error('Crash-recovery barrier client is not connected.');
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = await barrier.query<{ pid: number }>(`SELECT activity.pid
          FROM pg_stat_activity AS activity
          JOIN pg_locks AS lock ON lock.pid = activity.pid
          WHERE activity.application_name = $1 AND activity.datname = current_database()
            AND activity.pid <> pg_backend_pid()
            AND lock.locktype = 'relation' AND lock.relation = to_regclass($2)
            AND lock.mode = 'AccessShareLock' AND NOT lock.granted`,
        [applicationName, mergeJournalTable]);
        if (result.rows[0]) return result.rows[0].pid;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      const snapshot = await barrier.query<{ pid: number; state: string; waitEventType: string | null; waitEvent: string | null; query: string }>(`
        SELECT activity.pid, activity.state, activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent",
          LEFT(regexp_replace(regexp_replace(activity.query, $$'([^']|'')*'$$, '[redacted]', 'g'),
            '[0-9a-fA-F]{32,}', '[redacted]', 'g'), 180) AS query
        FROM pg_stat_activity AS activity
        JOIN pg_locks AS lock ON lock.pid = activity.pid
        WHERE activity.application_name = $1 AND activity.datname = current_database()
          AND activity.pid <> pg_backend_pid() AND lock.locktype = 'relation'
          AND lock.relation = to_regclass($2) AND lock.mode = 'AccessShareLock' AND NOT lock.granted
        ORDER BY activity.query_start DESC LIMIT 3`, [applicationName, mergeJournalTable]);
      throw new Error(`Maintenance did not wait for the merge table; waiter snapshot: ${JSON.stringify(snapshot.rows)}.`);
    };
    let mergeJournalTableLockHeld = false;
    const startApiAndObserveReconciliationScan = async (applicationName: string) => {
      if (!barrier) throw new Error('Crash-recovery barrier client is not connected.');
      await barrier.query('BEGIN');
      await barrier.query(`LOCK TABLE "${schema}"."pull_request_merge_operations" IN ACCESS EXCLUSIVE MODE`);
      mergeJournalTableLockHeld = true;
      let api: Awaited<ReturnType<typeof startApi>> | undefined;
      try {
        api = await startApi(applicationName);
        let maintenanceError: unknown;
        const maintenanceRun = api.runMaintenance().catch((error: unknown) => { maintenanceError = error; });
        const waiterPid = await waitForMergeReconciliationWaiter(applicationName, 30_000);
        await barrier.query('COMMIT');
        mergeJournalTableLockHeld = false;
        await waitForMergeReconciliationQueryToFinish(waiterPid, 30_000);
        await maintenanceRun;
        if (maintenanceError) throw maintenanceError;
        return api;
      } catch (error) {
        await barrier.query('ROLLBACK').catch(() => undefined);
        mergeJournalTableLockHeld = false;
        await stopApi(api?.process);
        throw error;
      }
    };

    let barrierLockHeld = false;
    let child: ChildProcessWithoutNullStreams | undefined;
    let youngRecovery: ChildProcessWithoutNullStreams | undefined;
    let agedRecovery: ChildProcessWithoutNullStreams | undefined;
    let parentMaintenancePaused = false;
    let triggerCreated = false;
    let functionCreated = false;
    const parentMaintenance = app.get(MaintenanceJobsService);
    try {
      const barrierUrl = new URL(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
      barrierUrl.searchParams.set('application_name', `${childApplicationName}-barrier`);
      barrier = new Client({ connectionString: barrierUrl.toString(), connectionTimeoutMillis: 5_000 });
      await barrier.connect();
      await barrier.query("SET statement_timeout = '5s'");
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [barrierKey]);
      barrierLockHeld = true;
      await admin.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.operation_id = '${operationId}' AND NEW.candidate_sha IS NOT NULL THEN
            PERFORM set_config('client_connection_check_interval', '50', true);
            PERFORM pg_advisory_lock(hashtextextended('${barrierKey}', 0));
            PERFORM pg_advisory_unlock(hashtextextended('${barrierKey}', 0));
          END IF;
          RETURN NEW;
        END $$`);
      functionCreated = true;
      await admin.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF candidate_sha
        ON "${schema}"."pull_request_merge_operations" FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);
      triggerCreated = true;

      const refsBeforeMerge = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']);
      expect(refsBeforeMerge).toBe(refsBefore);
      await parentMaintenance.onModuleDestroy();
      parentMaintenancePaused = true;
      const started = await startApi(childApplicationName);
      child = started.process;

      let mergeResponseStatus: number | undefined;
      let mergeRequestError: Error | undefined;
      const mergeRequest = httpRequest(`${started.base}/${repoPath}/${pullRequest.number}/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: ownerCookieForTest },
      }, (response) => { mergeResponseStatus = response.statusCode; response.resume(); });
      mergeRequest.on('error', (error) => { mergeRequestError = error; });
      const mergeRequestClosed = new Promise<void>((resolveClosed) => mergeRequest.once('close', resolveClosed));
      mergeRequest.end(JSON.stringify({ operationId, expectedSourceSha: comparison.sourceSha,
        expectedTargetSha: comparison.targetSha, storageGeneration: comparison.storageGeneration,
        version: detail.pullRequest.version }));

      const waitDeadline = Date.now() + 15_000;
      let childWaiters = 0;
      while (Date.now() < waitDeadline && childWaiters === 0) {
        const result = await barrier.query<{ count: number }>(`SELECT COUNT(*)::int AS count
          FROM pg_stat_activity AS activity JOIN pg_locks AS lock ON lock.pid = activity.pid
          WHERE activity.application_name = $1 AND activity.datname = current_database()
            AND activity.pid <> pg_backend_pid() AND activity.wait_event_type = 'Lock'
            AND activity.wait_event = 'advisory' AND lock.locktype = 'advisory' AND NOT lock.granted`, [childApplicationName]);
        childWaiters = result.rows[0]?.count ?? 0;
        if (childWaiters === 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      expect(childWaiters).toBeGreaterThan(0);
      const pending = await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } });
      expect(pending).toMatchObject({ status: 'PENDING', candidateSha: null, oldTargetSha: targetSha });
      expect(Date.now() - pending.createdAt.getTime()).toBeLessThan(120_000);
      expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/before-cas-target']).trim()).toBe(targetSha);

      const killed = new Promise<void>((resolveClosed, rejectClosed) => {
        const timeout = setTimeout(() => rejectClosed(new Error('Child API did not stop after SIGKILL.')), 5_000);
        child!.once('close', () => { clearTimeout(timeout); resolveClosed(); });
        killChildProcessTree(child!);
      });
      await killed;
      mergeRequest.destroy(new Error('Merge request canceled after child API process termination.'));
      let requestCloseTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([mergeRequestClosed, new Promise<void>((_, rejectTimeout) => {
          requestCloseTimeout = setTimeout(() => rejectTimeout(new Error('Merge request socket did not close.')), 5_000);
        })]);
      } finally { if (requestCloseTimeout) clearTimeout(requestCloseTimeout); }
      expect(mergeResponseStatus).toBeUndefined();
      expect(mergeRequestError).toBeDefined();
      // The trigger is still blocking the pre-CAS transaction, so its backend
      // cannot exit until the barrier is released. Terminate only sessions from
      // this child app in this isolated test database; that rolls back the
      // uncommitted candidate_sha update and preserves the durable PENDING row.
      await terminateApiSessions(childApplicationName);
      await waitForSessionsToExit(childApplicationName, 5_000);
      const unlocked = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [barrierKey]);
      expect(unlocked.rows[0]?.pg_advisory_unlock).toBe(true);
      barrierLockHeld = false;
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']))
        .toBe(refsBeforeMerge);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: pullRequest.id } }))
        .toMatchObject({ status: 'OPEN', mergedById: null, mergeCommitSha: null });
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } }))
        .toMatchObject({ status: 'PENDING', candidateSha: null, errorCode: null });
      expect(await db.auditLog.count({ where: { targetId: pullRequest.id,
        action: { in: ['PULL_REQUEST_MERGED', 'PULL_REQUEST_MERGE_RECONCILED'] } } })).toBe(0);

      const youngOperation = await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } });
      expect(Date.now() - youngOperation.createdAt.getTime()).toBeLessThan(120_000);
      const owner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'beforecasowner' } });
      const agedSentinelOperationId = randomUUID();
      await db.pullRequestMergeOperation.create({ data: {
        operationId: agedSentinelOperationId, repositoryId: storedRepo.id, pullRequestId: pullRequest.id,
        actorId: owner.id, storageGeneration: storedRepo.storageGeneration,
        expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        oldTargetSha: targetSha, createdAt: new Date(Date.now() - 121_000),
      } });
      const young = await startApiAndObserveReconciliationScan(firstRecoveryName);
      youngRecovery = young.process;
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } }))
        .toMatchObject({ status: 'PENDING', candidateSha: null, errorCode: null });
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId: agedSentinelOperationId } }))
        .toMatchObject({ status: 'FAILED', errorCode: 'REF_NOT_UPDATED', candidateSha: null, resultingSha: null });
      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']))
        .toBe(refsBeforeMerge);
      await stopApi(youngRecovery);
      await waitForSessionsToExit(firstRecoveryName, 5_000);
      youngRecovery = undefined;

      const aged = await db.pullRequestMergeOperation.updateMany({ where: { operationId, status: 'PENDING' },
        data: { createdAt: new Date(Date.now() - 121_000) } });
      expect(aged.count).toBe(1);
      const recovery = await startApiAndObserveReconciliationScan(secondRecoveryName);
      agedRecovery = recovery.process;
      const recoveryDeadline = Date.now() + 20_000;
      let failed = false;
      while (Date.now() < recoveryDeadline) {
        const operation = await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } });
        if (operation.status === 'FAILED' && operation.errorCode === 'REF_NOT_UPDATED') { failed = true; break; }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      expect(failed).toBe(true);
      await stopApi(agedRecovery);
      await waitForSessionsToExit(secondRecoveryName, 5_000);
      agedRecovery = undefined;

      expect(git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/']))
        .toBe(refsBeforeMerge);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: pullRequest.id } }))
        .toMatchObject({ status: 'OPEN', mergedById: null, mergeCommitSha: null });
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } }))
        .toMatchObject({ status: 'FAILED', errorCode: 'REF_NOT_UPDATED', candidateSha: null, resultingSha: null });
      expect(await db.auditLog.count({ where: { targetId: pullRequest.id,
        action: { in: ['PULL_REQUEST_MERGED', 'PULL_REQUEST_MERGE_RECONCILED'] } } })).toBe(0);
    } finally {
      const cleanupErrors: unknown[] = [];
      const attemptCleanup = async (cleanup: () => Promise<unknown>) => {
        try { await cleanup(); }
        catch (error) { cleanupErrors.push(error); }
      };

      let apiProcessesStopped = true;
      await Promise.all(startedApiProcesses.map(async ({ process: apiProcess }) => {
        try { await stopApi(apiProcess); }
        catch (error) {
          apiProcessesStopped = false;
          cleanupErrors.push(error);
        }
      }));
      if (mergeJournalTableLockHeld && barrier) {
        await attemptCleanup(async () => {
          await barrier!.query('ROLLBACK');
          mergeJournalTableLockHeld = false;
        });
      }
      let childSessionsConfirmed = true;
      for (const { applicationName } of startedApiProcesses) {
        try {
          await terminateApiSessions(applicationName);
          await waitForSessionsToExit(applicationName, 5_000);
        } catch (error) {
          childSessionsConfirmed = false;
          cleanupErrors.push(error);
        }
      }
      if (barrierLockHeld && barrier) {
        await attemptCleanup(async () => {
          const unlocked = await barrier!.query<{ pg_advisory_unlock: boolean }>(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [barrierKey]);
          if (!unlocked.rows[0]?.pg_advisory_unlock) throw new Error('Crash-recovery advisory lock was not released.');
          barrierLockHeld = false;
        });
      }
      let barrierClosed = !barrier;
      if (barrier) {
        await attemptCleanup(async () => {
          await barrier!.end();
          barrierClosed = true;
          mergeJournalTableLockHeld = false;
          barrierLockHeld = false;
        });
      }
      if (apiProcessesStopped && childSessionsConfirmed && barrierClosed) {
        if (triggerCreated) {
          await attemptCleanup(() => admin.$executeRawUnsafe(
            `DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."pull_request_merge_operations"`));
        }
        if (functionCreated) {
          await attemptCleanup(() => admin.$executeRawUnsafe(
            `DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`));
        }
      } else {
        cleanupErrors.push(new Error('Preserved test trigger/function because API process exit, child database sessions, or barrier closure was not confirmed.'));
      }
      if (parentMaintenancePaused) {
        await attemptCleanup(async () => { parentMaintenance.onModuleInit(); });
      }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Pre-CAS merge crash test teardown had cleanup failures.');
    }
  }, 180_000);

  processCrashTest('reconciles a Git-updated merge after the API process dies before metadata commit', async () => {
    const registered = await call('POST', 'auth/register', {
      username: 'CrashOwner', email: 'crash-owner@example.test', password: 'test-password-123',
    });
    expect(registered.status).toBe(201);
    const crashCookie = cookie(registered);
    const createdRepo = await call('POST', 'repositories', {
      name: 'MergeCrash', visibility: 'PRIVATE', initializeReadme: true,
    }, crashCookie);
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);
    const work = join(storageRoot, 'merge-crash-clone');
    const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['clone', bare, work]);
    git(['-C', work, 'config', 'user.name', 'Crash Owner']);
    git(['-C', work, 'config', 'user.email', 'crash-owner@example.test']);
    git(['-C', work, 'switch', '-c', 'release/crash-target']);
    git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/release/crash-target']);
    git(['-C', work, 'switch', 'main']);
    git(['-C', work, 'switch', '-c', 'feature/crash-recovery']);
    await writeFile(join(work, 'crash-recovered.txt'), 'recovered after API process death\n');
    git(['-C', work, 'add', 'crash-recovered.txt']);
    git(['-C', work, 'commit', '-m', 'Add crash recovery fixture']);
    const sourceSha = git(['-C', work, 'rev-parse', 'HEAD']).trim();
    git(['-C', work, 'push', 'origin', 'feature/crash-recovery']);
    const targetSha = git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/crash-target']).trim();
    const repoPath = 'repos/crashowner/mergecrash/pulls';
    const createdPull = await call('POST', repoPath, {
      title: 'Recover after API process death', description: 'Verify crash-safe Git and PostgreSQL reconciliation.',
      sourceBranch: 'feature/crash-recovery', targetBranch: 'release/crash-target',
    }, crashCookie);
    expect(createdPull.status).toBe(201);
    const { pullRequest } = await responseJson<{ pullRequest: { id: string; number: number } }>(createdPull);
    const detailResponse = await call('GET', `${repoPath}/${pullRequest.number}`, undefined, crashCookie);
    const detail = await responseJson<{ pullRequest: { version: number }; }>(detailResponse);
    expect(detailResponse.status).toBe(200);
    const compareResponse = await call('GET', `${repoPath}/${pullRequest.number}/compare`, undefined, crashCookie);
    const comparison = await responseJson<{ sourceSha: string; targetSha: string; storageGeneration: number }>(compareResponse);
    expect(compareResponse.status).toBe(200);

    const triggerName = `pause_merge_${schema.slice(-12)}`;
    const functionName = `${triggerName}_fn`;
    const operationId = randomUUID();
    let candidateSha = '';
    let child: ChildProcessWithoutNullStreams | undefined;
    let replacementChild: ChildProcessWithoutNullStreams | undefined;
    let barrierClient: Client | undefined;
    let barrierLockHeld = false;
    const childApplicationName = `merge-crash-${schema.slice(-12)}`;
    const replacementApplicationName = `merge-recovery-${schema.slice(-12)}`;
    const barrierKey = `merge-crash-barrier-${schema.slice(-12)}`;
    const parentMaintenance = app.get(MaintenanceJobsService);
    let parentMaintenancePaused = false;
    try {
      const barrierConnectionUrl = new URL(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
      barrierConnectionUrl.searchParams.set('application_name', `${childApplicationName}-barrier`);
      const barrier = new Client({ connectionString: barrierConnectionUrl.toString(), connectionTimeoutMillis: 5_000 });
      barrierClient = barrier;
      await barrier.connect();
      await barrier.query("SET statement_timeout = '5s'");
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [barrierKey]);
      barrierLockHeld = true;
      await admin.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = '${pullRequest.id}' AND NEW.status = 'MERGED' THEN
            -- Linux-only test setting: let PostgreSQL notice that the killed API client's TCP socket closed
            -- even while this backend is waiting on the test advisory barrier.
            PERFORM set_config('client_connection_check_interval', '50', true);
            PERFORM pg_advisory_lock(hashtextextended('${barrierKey}', 0));
            PERFORM pg_advisory_unlock(hashtextextended('${barrierKey}', 0));
          END IF;
          RETURN NEW;
        END $$`);
      await admin.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "${schema}"."pull_requests"
        FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);

      // The child and test app may run startup maintenance concurrently. The
      // PENDING journal stays younger than the 120s cutoff through crash proof;
      // age it only after all child PostgreSQL sessions have naturally exited.
      const childScript = `
        require('reflect-metadata');
        const { NestFactory } = require('@nestjs/core');
        const { ValidationPipe } = require('@nestjs/common');
        const cookieParser = require('cookie-parser');
        (async () => {
          const { AppModule } = require(process.env.CODE_FORGE_TEST_APP_MODULE);
          const app = await NestFactory.create(AppModule, { logger: false });
          app.use(cookieParser());
          app.setGlobalPrefix('api/v1');
          app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
          await app.listen(0, '127.0.0.1');
          process.stdout.write('CODE_FORGE_TEST_READY:' + await app.getUrl() + '\\n');
        })().catch(() => process.exit(2));
      `;
      const backendRoot = resolve(__dirname, '..');
      const startApi = async (applicationName: string) => {
        const databaseUrl = new URL(process.env.DATABASE_URL!);
        databaseUrl.searchParams.set('application_name', applicationName);
        const apiProcess = spawn(process.execPath, ['-r', requireFromBackend.resolve('ts-node/register'), '-e', childScript], {
          detached: true,
          cwd: backendRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString(),
            DATABASE_URL_UNPOOLED: databaseUrl.toString(), GIT_STORAGE_PATH: storageRoot,
            CODE_FORGE_TEST_APP_MODULE: join(backendRoot, 'src', 'app.module.ts') },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        let errorOutput = '';
        let isReady = false;
        apiProcess.stderr.setEncoding('utf8');
        apiProcess.stderr.on('data', (chunk: string) => { errorOutput += chunk; });
        try {
          const apiBase = await new Promise<string>((resolveReady, rejectReady) => {
            const timeout = setTimeout(() => rejectReady(new Error('Child API did not become ready.')), 12_000);
            apiProcess.stdout.setEncoding('utf8');
            apiProcess.stdout.on('data', (chunk: string) => {
              output += chunk;
              const ready = output.match(/CODE_FORGE_TEST_READY:(http:\/\/127\.0\.0\.1:\d+)/);
              if (ready) { isReady = true; clearTimeout(timeout); resolveReady(`${ready[1]}/api/v1`); }
            });
            apiProcess.on('error', (error) => {
              if (!isReady) { clearTimeout(timeout); rejectReady(error); }
            });
            apiProcess.once('exit', () => {
              clearTimeout(timeout);
              if (!isReady) rejectReady(new Error('Child API exited before becoming ready.'));
            });
          });
          return { process: apiProcess, base: apiBase };
        } catch (startupError) {
          let cleanupError: unknown;
          if (apiProcess.pid && apiProcess.exitCode === null && apiProcess.signalCode === null) {
            const processExited = new Promise<void>((resolveExited) => {
              if (apiProcess.exitCode !== null || apiProcess.signalCode !== null) { resolveExited(); return; }
              apiProcess.once('exit', () => resolveExited());
            });
            try {
              killChildProcessTree(apiProcess);
              await processExited;
            } catch (error) { cleanupError = error; }
          }
          const diagnostic = startupError instanceof Error ? startupError.message
            : typeof startupError === 'string' ? startupError : 'Child API failed to start for an unknown reason.';
          const stderr = errorOutput.slice(-2000);
          const cleanupDiagnostic = cleanupError instanceof Error ? cleanupError.message
            : typeof cleanupError === 'string' ? cleanupError : cleanupError ? 'Unknown cleanup error.' : undefined;
          throw new Error([diagnostic, stderr && `Child API stderr:\n${stderr}`,
            cleanupDiagnostic && `Child API cleanup failed: ${cleanupDiagnostic}`].filter(Boolean).join('\n'),
          { cause: startupError });
        }
      };
      const waitForApiSessionsToExit = async (applicationName: string, timeoutMs: number) => {
        const deadline = Date.now() + timeoutMs;
        let sessions: Array<{ pid: number; state: string | null; wait_event_type: string | null;
          wait_event: string | null; application_name: string; client_addr: string | null; backend_start: Date }> = [];
        while (Date.now() < deadline) {
          const rows = await barrier.query<{ pid: number; state: string | null; wait_event_type: string | null;
            wait_event: string | null; application_name: string; client_addr: string | null; backend_start: Date }>(
            `SELECT pid, state, wait_event_type, wait_event, application_name, client_addr, backend_start FROM pg_stat_activity
             WHERE application_name = $1 AND pid <> pg_backend_pid()`, [applicationName]);
          sessions = rows.rows;
          if (sessions.length === 0) break;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
        return sessions;
      };
      const startedApi = await startApi(childApplicationName);
      child = startedApi.process;
      const childProcess = child;
      const childBase = startedApi.base;
      let mergeResponseStatus: number | undefined;
      let mergeRequestError: Error | undefined;
      const mergeRequest = httpRequest(`${childBase}/${repoPath}/${pullRequest.number}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: crashCookie },
      }, (response) => {
        mergeResponseStatus = response.statusCode;
        response.resume();
      });
      mergeRequest.on('error', (error) => { mergeRequestError = error; });
      const mergeRequestClosed = new Promise<void>((resolveClosed) => mergeRequest.once('close', resolveClosed));
      mergeRequest.end(JSON.stringify({ operationId, expectedSourceSha: comparison.sourceSha,
        expectedTargetSha: comparison.targetSha, storageGeneration: comparison.storageGeneration,
        version: detail.pullRequest.version }));

      const refDeadline = Date.now() + 15_000;
      let movedTargetSha = targetSha;
      while (Date.now() < refDeadline && movedTargetSha === targetSha) {
        movedTargetSha = git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/crash-target']).trim();
        if (movedTargetSha === targetSha) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      expect(movedTargetSha).not.toBe(targetSha);
      candidateSha = movedTargetSha;
      const pendingOperation = await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } });
      expect(pendingOperation).toMatchObject({ status: 'PENDING', candidateSha });
      const childWaitDeadline = Date.now() + 5_000;
      let childWaitingOnBarrier = 0;
      while (Date.now() < childWaitDeadline && childWaitingOnBarrier === 0) {
        const result = await barrier.query<{ count: number }>(`SELECT COUNT(*)::int AS count
          FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'`,
        [childApplicationName]);
        childWaitingOnBarrier = result.rows[0]?.count ?? 0;
        if (childWaitingOnBarrier === 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      expect(childWaitingOnBarrier).toBeGreaterThan(0);

      // Git's ref CAS has happened; the trigger holds PostgreSQL before the PR
      // metadata transaction commits. Kill the separate API process at this boundary.
      const childClosed = new Promise<void>((resolveClosed, rejectClosed) => {
        if (childProcess.exitCode !== null || childProcess.signalCode !== null) { resolveClosed(); return; }
        const timeout = setTimeout(() => rejectClosed(new Error('Child API did not stop after SIGKILL.')), 5_000);
        childProcess.once('close', () => { clearTimeout(timeout); resolveClosed(); });
        childProcess.once('error', () => { clearTimeout(timeout); rejectClosed(new Error('Child API process could not be stopped.')); });
        killChildProcessTree(childProcess);
      });
      await childClosed;
      expect(childProcess.exitCode !== null || childProcess.signalCode !== null).toBe(true);
      mergeRequest.destroy(new Error('Merge request canceled after child API process termination.'));
      let requestCloseTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([mergeRequestClosed, new Promise<void>((_, rejectTimeout) => {
          requestCloseTimeout = setTimeout(() => rejectTimeout(new Error('Merge HTTP request socket did not close.')), 5_000);
        })]);
      } finally { if (requestCloseTimeout) clearTimeout(requestCloseTimeout); }
      expect(mergeResponseStatus).toBeUndefined();
      expect(mergeRequestError).toBeDefined();
      const barrierReleased = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [barrierKey]);
      expect(barrierReleased.rows[0]?.pg_advisory_unlock).toBe(true);
      barrierLockHeld = false;
      // Let PostgreSQL leave the test barrier and observe that the killed API
      // client is gone; waiting before releasing this lock deadlocks the proof.
      const childSessions = await waitForApiSessionsToExit(childApplicationName, 60_000);
      expect(childSessions).toHaveLength(0);
      expect(await db.pullRequest.findUniqueOrThrow({ where: { id: pullRequest.id } }))
        .toMatchObject({ status: 'OPEN', mergeCommitSha: null });
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } }))
        .toMatchObject({ status: 'PENDING', candidateSha });
      const parents = git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', candidateSha]).trim().split(' ');
      expect(parents).toHaveLength(3);
      expect(parents.slice(1).sort()).toEqual([targetSha, sourceSha].sort());

      // Disable this test process's scheduler so only the replacement API's
      // onModuleInit startup run can perform the restart reconciliation.
      await parentMaintenance.onModuleDestroy();
      parentMaintenancePaused = true;
      const agedOperation = await db.pullRequestMergeOperation.updateMany({ where: { operationId, status: 'PENDING' },
        data: { createdAt: new Date(Date.now() - 121_000) } });
      expect(agedOperation.count).toBe(1);
      const replacement = await startApi(replacementApplicationName);
      replacementChild = replacement.process;
      const replacementDeadline = Date.now() + 20_000;
      let replacementRecovered = false;
      while (Date.now() < replacementDeadline) {
        const [operation, pull] = await Promise.all([
          db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } }),
          db.pullRequest.findUniqueOrThrow({ where: { id: pullRequest.id } }),
        ]);
        if (operation.status === 'COMPLETED' && pull.status === 'MERGED') {
          replacementRecovered = true;
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      expect(replacementRecovered).toBe(true);
      const replacementClosed = new Promise<void>((resolveClosed, rejectClosed) => {
        if (replacement.process.exitCode !== null || replacement.process.signalCode !== null) { resolveClosed(); return; }
        const timeout = setTimeout(() => rejectClosed(new Error('Replacement API did not stop after reconciliation.')), 5_000);
        replacement.process.once('close', () => { clearTimeout(timeout); resolveClosed(); });
        replacement.process.once('error', () => { clearTimeout(timeout); rejectClosed(new Error('Replacement API process could not be stopped.')); });
        killChildProcessTree(replacement.process);
      });
      await replacementClosed;
      expect(await waitForApiSessionsToExit(replacementApplicationName, 5_000)).toHaveLength(0);
      replacementChild = undefined;
      const recoveredDetailResponse = await call('GET', `${repoPath}/${pullRequest.number}`, undefined, crashCookie);
      expect(recoveredDetailResponse.status).toBe(200);
      const recoveredDetail = await responseJson<{
        pullRequest: { status: string; mergedById: string | null; mergeCommitSha: string | null };
        mergeOperation: { operationId: string; status: string; errorCode: string | null } | null;
      }>(recoveredDetailResponse);
      const crashOwner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'crashowner' } });
      expect(recoveredDetail).toMatchObject({
        pullRequest: { status: 'MERGED', mergedById: crashOwner.id, mergeCommitSha: candidateSha },
        mergeOperation: { operationId, status: 'COMPLETED' },
      });
      expect(await db.pullRequestMergeOperation.findUniqueOrThrow({ where: { operationId } }))
        .toMatchObject({ status: 'COMPLETED', resultingSha: candidateSha, actorId: crashOwner.id });
      expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/crash-target']).trim()).toBe(candidateSha);
      expect(await db.auditLog.count({ where: { targetId: pullRequest.id, action: 'PULL_REQUEST_MERGE_RECONCILED' } })).toBe(1);

      const tokenResponse = await call('POST', 'tokens', {
        name: 'Merge crash recovery E2E', scopes: ['repo:read', 'repo:write'],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }, crashCookie);
      expect(tokenResponse.status).toBe(201);
      const token = await responseJson<{ token: { id: string }; secret: string }>(tokenResponse);
      const askpass = join(storageRoot, 'merge-crash-askpass.sh');
      await writeFile(askpass,
        '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
        { mode: 0o700 });
      const runGit = promisify(execFile);
      const gitHttp = (args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
        timeout: 20_000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
          GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'CrashOwner', TEST_GIT_PAT: token.secret },
      });
      await gitHttp(['-C', work, 'remote', 'set-url', 'origin', `${base}/git/CrashOwner/MergeCrash.git`]);
      git(['-C', work, 'fetch', bare, 'refs/heads/release/crash-target']);
      git(['-C', work, 'switch', '--detach', 'FETCH_HEAD']);
      git(['-C', work, 'switch', '-c', 'feature/after-crash']);
      await writeFile(join(work, 'post-crash.txt'), 'push after crash reconciliation\n');
      git(['-C', work, 'add', 'post-crash.txt']);
      git(['-C', work, 'commit', '-m', 'Push after crash reconciliation']);
      await gitHttp(['-C', work, 'push', 'origin', 'HEAD:refs/heads/release/crash-target']);
      const pushedAfterRecoverySha = git(['-C', work, 'rev-parse', 'HEAD']).trim();
      expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/release/crash-target']).trim()).toBe(pushedAfterRecoverySha);
      const retry = await call('POST', `${repoPath}/${pullRequest.number}/merge`, {
        operationId, expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: detail.pullRequest.version,
      }, crashCookie);
      expect(retry.status).toBe(200);
      expect(await responseJson(retry)).toMatchObject({ status: 'MERGED', operationId, mergeCommitSha: candidateSha });
      expect(await db.auditLog.count({ where: { targetId: pullRequest.id, action: 'PULL_REQUEST_MERGE_RECONCILED' } })).toBe(1);
      const fetched = join(storageRoot, 'merge-crash-fetch');
      git(['clone', '--branch', 'release/crash-target', bare, fetched]);
      expect(git(['-C', fetched, 'show', 'HEAD:crash-recovered.txt'])).toBe('recovered after API process death\n');
    } finally {
      try {
        if (replacementChild && replacementChild.exitCode === null && replacementChild.signalCode === null) {
          await new Promise<void>((resolveClosed, rejectClosed) => {
            const timeout = setTimeout(() => rejectClosed(new Error('Replacement API cleanup timed out.')), 5_000);
            replacementChild!.once('close', () => { clearTimeout(timeout); resolveClosed(); });
            killChildProcessTree(replacementChild!);
          });
        }
      } finally {
        try {
          if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise<void>((resolveClosed, rejectClosed) => {
              const timeout = setTimeout(() => rejectClosed(new Error('Child API cleanup timed out.')), 5_000);
              child!.once('close', () => { clearTimeout(timeout); resolveClosed(); });
              killChildProcessTree(child!);
            });
          }
        } finally {
          try {
            if (barrierClient) {
              for (const applicationName of [childApplicationName, replacementApplicationName]) {
                const childBackends = await barrierClient.query<{ pid: number }>(
                  'SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()',
                  [applicationName]);
                for (const backend of childBackends.rows) {
                  await barrierClient.query('SELECT pg_terminate_backend($1)', [backend.pid]);
                }
              }
            }
          } finally {
            try {
              if (barrierLockHeld && barrierClient) {
                await barrierClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [barrierKey]);
                barrierLockHeld = false;
              }
            } finally {
              try {
                await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."pull_requests"`);
              } finally {
                try {
                  await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`);
                } finally {
                  try {
                    await barrierClient?.end();
                  } finally {
                    if (parentMaintenancePaused) parentMaintenance.onModuleInit();
                  }
                }
              }
            }
          }
        }
      }
    }
  }, 180_000);

  it('serializes a source-branch push against a merge snapshot', async () => {
    const registered = await call('POST', 'auth/register', {
      username: 'RaceOwner', email: 'race-owner@example.test', password: 'test-password-123',
    });
    expect(registered.status).toBe(201);
    const raceOwnerCookie = cookie(registered);

    const writerRegistered = await call('POST', 'auth/register', {
      username: 'RaceWriter', email: 'race-writer@example.test', password: 'test-password-123',
    }, '');
    expect(writerRegistered.status).toBe(201);
    const raceWriterCookie = cookie(writerRegistered);

    const createdRepo = await call('POST', 'repositories', {
      name: 'PushMergeRace', visibility: 'PRIVATE', initializeReadme: true,
    }, raceOwnerCookie);
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);

    const inviteResponse = await call('POST', 'repos/raceowner/pushmergerace/invitations', {
      username: 'RaceWriter', role: 'WRITE',
    }, raceOwnerCookie);
    expect(inviteResponse.status).toBe(201);
    const invite = await responseJson<{ invitation: { id: string } }>(inviteResponse);
    const accepted = await call('POST', `invitations/${invite.invitation.id}/accept`, undefined, raceWriterCookie);
    expect(accepted.status).toBe(201);

    const tokenResponse = await call('POST', 'tokens', {
      name: 'Push/merge race', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, raceWriterCookie);
    expect(tokenResponse.status).toBe(201);
    const token = await responseJson<{ token: { id: string }; secret: string }>(tokenResponse);

    const askpass = join(storageRoot, 'git-race-askpass.sh');
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
      { mode: 0o700 });
    const runGit = promisify(execFile);
    const git = (args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'RaceWriter', TEST_GIT_PAT: token.secret },
    });
    const repoUrl = `${base}/git/RaceOwner/PushMergeRace.git`;
    const writerWork = join(storageRoot, 'push-merge-race-clone');
    await git(['clone', repoUrl, writerWork]);
    await git(['-C', writerWork, 'config', 'user.name', 'Race Writer']);
    await git(['-C', writerWork, 'config', 'user.email', 'race-writer@example.test']);
    await git(['-C', writerWork, 'switch', '-c', 'feature/concurrent-source-update']);
    await writeFile(join(writerWork, 'race.txt'), 'source snapshot\n');
    await git(['-C', writerWork, 'add', 'race.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Create merge snapshot']);
    const snapshotSourceSha = (await git(['-C', writerWork, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', writerWork, 'push', '--set-upstream', 'origin', 'feature/concurrent-source-update']);
    const snapshotTargetSha = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim();

    const repoPath = 'repos/raceowner/pushmergerace/pulls';
    const createdPull = await call('POST', repoPath, {
      title: 'Race source push and merge', description: 'Concurrent Git and merge mutation regression.',
      sourceBranch: 'feature/concurrent-source-update', targetBranch: 'main',
    }, raceOwnerCookie);
    expect(createdPull.status).toBe(201);
    const pull = await responseJson<{ pullRequest: { id: string; number: number } }>(createdPull);
    const detailResponse = await call('GET', `${repoPath}/${pull.pullRequest.number}`, undefined, raceOwnerCookie);
    expect(detailResponse.status).toBe(200);
    const detail = await responseJson<{ pullRequest: { status: string; version: number } }>(detailResponse);
    expect(detail.pullRequest.status).toBe('OPEN');
    const compareResponse = await call('GET', `${repoPath}/${pull.pullRequest.number}/compare`, undefined, raceOwnerCookie);
    expect(compareResponse.status).toBe(200);
    const comparison = await responseJson<{ state: string; sourceSha: string; targetSha: string; storageGeneration: number }>(compareResponse);
    expect(comparison).toMatchObject({ state: 'READY', sourceSha: snapshotSourceSha, targetSha: snapshotTargetSha,
      storageGeneration: storedRepo.storageGeneration });

    await writeFile(join(writerWork, 'race.txt'), 'source advanced during merge\n');
    await git(['-C', writerWork, 'add', 'race.txt']);
    await git(['-C', writerWork, 'commit', '-m', 'Advance PR source during merge']);
    const advancedSourceSha = (await git(['-C', writerWork, 'rev-parse', 'HEAD'])).stdout.trim();
    const operationId = randomUUID();
    const [, mergeResponse] = await Promise.all([
      Promise.resolve().then(() => git(['-C', writerWork, 'push', 'origin', 'HEAD:refs/heads/feature/concurrent-source-update'])),
      Promise.resolve().then(() => call('POST', `${repoPath}/${pull.pullRequest.number}/merge`, {
        operationId, expectedSourceSha: comparison.sourceSha, expectedTargetSha: comparison.targetSha,
        storageGeneration: comparison.storageGeneration, version: detail.pullRequest.version,
      }, raceOwnerCookie)),
    ]);
    expect(advancedSourceSha).toMatch(/^[a-f0-9]{40,64}$/);
    expect([200, 409]).toContain(mergeResponse.status);
    expect((await git(['--git-dir', bare, 'rev-parse', 'refs/heads/feature/concurrent-source-update'])).stdout.trim())
      .toBe(advancedSourceSha);

    const targetAfterRace = (await git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim();
    const racedPull = await db.pullRequest.findUniqueOrThrow({ where: { id: pull.pullRequest.id } });
    const racedOperations = await db.pullRequestMergeOperation.findMany({ where: { pullRequestId: pull.pullRequest.id } });
    const mergeAudits = await db.auditLog.count({ where: { targetId: pull.pullRequest.id, action: 'PULL_REQUEST_MERGED' } });
    if (mergeResponse.status === 200) {
      const result = await responseJson<{ status: string; operationId: string; mergeCommitSha: string }>(mergeResponse);
      expect(result).toMatchObject({ status: 'MERGED', operationId });
      expect(targetAfterRace).toBe(result.mergeCommitSha);
      const parents = (await git(['--git-dir', bare, 'rev-list', '--parents', '-n', '1', result.mergeCommitSha]))
        .stdout.trim().split(' ');
      expect(parents).toHaveLength(3);
      expect(parents.slice(1).sort()).toEqual([snapshotTargetSha, snapshotSourceSha].sort());
      expect(racedPull).toMatchObject({ status: 'MERGED', mergeCommitSha: result.mergeCommitSha });
      expect(racedOperations).toHaveLength(1);
      expect(racedOperations[0]).toMatchObject({ operationId, status: 'COMPLETED', resultingSha: result.mergeCommitSha });
      expect(mergeAudits).toBe(1);
    } else {
      expect(await responseJson<{ error: { code: string } }>(mergeResponse)).toMatchObject({ error: { code: 'STALE_COMPARE' } });
      expect(targetAfterRace).toBe(snapshotTargetSha);
      expect(racedPull).toMatchObject({ status: 'OPEN', mergeCommitSha: null });
      expect(racedOperations).toHaveLength(0);
      expect(mergeAudits).toBe(0);
    }
  }, 60_000);
});

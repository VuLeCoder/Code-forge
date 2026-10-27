import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { GitStorageService } from '../src/repositories/git-storage.service';
// cookie-parser is CommonJS; use the compatible import form in the Jest runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');

describe('Admin HTTP + isolated PostgreSQL + Git', () => {
  const schema = `admin_test_${randomBytes(8).toString('hex')}`;
  const password = 'admin-e2e-password-123';
  let adminDb: PrismaClient | undefined;
  let db: PrismaClient | undefined;
  let app: INestApplication | undefined;
  let base = '';
  let origin = '';
  let storageRoot = '';
  let schemaCreated = false;
  let originalDatabaseUrl: string | undefined;
  let originalDatabaseUrlUnpooled: string | undefined;
  let originalGitStoragePath: string | undefined;
  let adminAccount: { userId: string; cookie: string } | undefined;

  const cookie = (response: Response) => response.headers.getSetCookie()
    .map((value) => value.split(';')[0]).join('; ');
  const call = (method: string, path: string, cookies = '', body?: unknown) => fetch(`${base}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookies ? { Cookie: cookies } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const runGit = (args: string[], input?: string, env: NodeJS.ProcessEnv = {}) => execFileSync('git', args, {
    encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env },
  }).trim();

  beforeAll(async () => {
    await ConfigModule.forRoot({ envFilePath: '.env' });
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalDatabaseUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
    originalGitStoragePath = process.env.GIT_STORAGE_PATH;
    if (!originalDatabaseUrl) throw new Error('DATABASE_URL is required for integration tests');

    const target = new URL(originalDatabaseUrl);
    const databaseName = decodeURIComponent(target.pathname.slice(1));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !databaseName.endsWith('_test')) {
      throw new Error('Admin integration tests require a local PostgreSQL database whose name ends in _test.');
    }

    storageRoot = await mkdtemp(join(tmpdir(), 'code-forge-admin-'));
    process.env.GIT_STORAGE_PATH = storageRoot;
    adminDb = new PrismaClient({ datasourceUrl: originalDatabaseUrl });
    await adminDb.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const isolatedUrl = new URL(originalDatabaseUrl);
    isolatedUrl.searchParams.set('schema', schema);
    isolatedUrl.searchParams.set('application_name', `admin-e2e-${schema.slice(-12)}`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    process.env.DATABASE_URL_UNPOOLED = isolatedUrl.toString();
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });

    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      // Admin acceptance covers account-lock behavior, not rate limiting;
      // auth.e2e-spec exercises the real throttling behavior separately.
      .overrideProvider(ThrottlerStorage).useValue({ increment: (_key: string, ttl: number) => Promise.resolve({
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
    if (schemaCreated && adminDb) await adminDb.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminDb?.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      DATABASE_URL: originalDatabaseUrl,
      DATABASE_URL_UNPOOLED: originalDatabaseUrlUnpooled,
      GIT_STORAGE_PATH: originalGitStoragePath,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30_000);

  it('locks and unlocks users, preserves private-source boundaries, and filters audit details', async () => {
    const register = async (username: string) => {
      const response = await call('POST', 'auth/register', '', {
        username, email: `${username.toLowerCase()}@example.test`, password,
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { user: { id: string } };
      return { userId: body.user.id, cookie: cookie(response) };
    };

    const admin = await register('AdminOwner');
    adminAccount = admin;
    const lockedUser = await register('LockedMember');
    const repositoryOwner = await register('PrivateOwner');
    await db!.user.update({ where: { id: admin.userId }, data: { systemRole: 'ADMIN' } });

    const selfLock = await call('PATCH', `admin/users/${admin.userId}/status`, admin.cookie, { status: 'LOCKED' });
    expect(selfLock.status).toBe(409);
    expect(await selfLock.json()).toMatchObject({ error: { code: 'CANNOT_LOCK_SELF' } });
    expect(await db!.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { status: true } }))
      .toMatchObject({ status: 'ACTIVE' });
    expect((await call('GET', 'auth/me', admin.cookie)).status).toBe(200);
    expect(await db!.auditLog.count({ where: {
      actorId: admin.userId, targetId: admin.userId, action: 'ADMIN_USER_LOCKED',
    } })).toBe(0);

    const publicRepository = await call('POST', 'repositories', lockedUser.cookie, {
      name: 'PatLockGate', visibility: 'PUBLIC', initializeReadme: true,
    });
    expect(publicRepository.status).toBe(201);
    const patResponse = await call('POST', 'tokens', lockedUser.cookie, {
      name: 'Admin lock E2E', scopes: ['repo:read'], expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(patResponse.status).toBe(201);
    const { secret: patSecret } = await patResponse.json() as { secret: string };
    const patAuthorization = `Basic ${Buffer.from(`LockedMember:${patSecret}`).toString('base64')}`;
    const gitAdvertisement = () => fetch(`${base}/git/LockedMember/PatLockGate.git/info/refs?service=git-upload-pack`, {
      headers: { Authorization: patAuthorization },
    });
    expect((await gitAdvertisement()).status).toBe(200);

    const activeSession = await db!.session.findFirstOrThrow({ where: { userId: lockedUser.userId, revokedAt: null } });
    const lockResponse = await call('PATCH', `admin/users/${lockedUser.userId}/status`, admin.cookie, { status: 'LOCKED' });
    expect(lockResponse.status).toBe(200);
    expect(await lockResponse.json()).toMatchObject({ changed: true, user: { id: lockedUser.userId, status: 'LOCKED' } });
    const lockedSession = await db!.session.findUniqueOrThrow({ where: { id: activeSession.id } });
    expect(lockedSession.revokedAt).toBeInstanceOf(Date);
    expect((await call('GET', 'auth/me', lockedUser.cookie)).status).toBe(401);
    expect((await gitAdvertisement()).status).toBe(401);
    expect((await fetch(`${base}/git/LockedMember/PatLockGate.git/info/refs?service=git-upload-pack`)).status).toBe(200);
    expect(await db!.repository.findFirstOrThrow({ where: { name: 'PatLockGate' }, select: { status: true, visibility: true } }))
      .toMatchObject({ status: 'ACTIVE', visibility: 'PUBLIC' });
    expect(await db!.auditLog.findFirst({ where: {
      actorId: admin.userId, targetId: lockedUser.userId, action: 'ADMIN_USER_LOCKED',
      details: { equals: { from: 'ACTIVE', to: 'LOCKED' } },
    } })).not.toBeNull();

    const unlockResponse = await call('PATCH', `admin/users/${lockedUser.userId}/status`, admin.cookie, { status: 'ACTIVE' });
    expect(unlockResponse.status).toBe(200);
    expect(await unlockResponse.json()).toMatchObject({ changed: true, user: { id: lockedUser.userId, status: 'ACTIVE' } });
    expect((await call('GET', 'auth/me', lockedUser.cookie)).status).toBe(401);
    expect(await db!.auditLog.findFirst({ where: {
      actorId: admin.userId, targetId: lockedUser.userId, action: 'ADMIN_USER_UNLOCKED',
      details: { equals: { from: 'LOCKED', to: 'ACTIVE' } },
    } })).not.toBeNull();
    const relogin = await call('POST', 'auth/login', '', { login: 'LockedMember', password });
    expect(relogin.status).toBe(200);
    expect((await call('GET', 'auth/me', cookie(relogin))).status).toBe(200);

    const restorableResponse = await call('POST', 'repositories', repositoryOwner.cookie, {
      name: 'AdminRestore', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(restorableResponse.status).toBe(201);
    const restorable = await db!.repository.findFirstOrThrow({
      where: { ownerId: repositoryOwner.userId, normalizedName: 'adminrestore' },
    });
    expect((await call('DELETE', 'repos/PrivateOwner/AdminRestore', repositoryOwner.cookie)).status).toBe(204);
    expect(await db!.repository.findUniqueOrThrow({ where: { id: restorable.id } })).toMatchObject({ status: 'DELETED' });

    const restoreResponse = await call('POST', `admin/repositories/${restorable.id}/restore`, admin.cookie);
    expect(restoreResponse.status).toBe(201);
    expect(await restoreResponse.json()).toMatchObject({
      repository: { id: restorable.id, status: 'ACTIVE' },
      sourceMayBeReset: true,
    });
    expect(await db!.repository.findUniqueOrThrow({ where: { id: restorable.id } })).toMatchObject({
      status: 'ACTIVE', deletedAt: null, purgeAfter: null,
    });
    expect(await db!.auditLog.findFirst({ where: {
      actorId: admin.userId, targetId: restorable.id, action: 'ADMIN_REPOSITORY_RESTORED',
      details: { equals: { from: 'DELETED', to: 'ACTIVE' } },
    } })).not.toBeNull();

    const expiredRepositoryResponse = await call('POST', 'repositories', repositoryOwner.cookie, {
      name: 'ExpiredRestore', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(expiredRepositoryResponse.status).toBe(201);
    const expiredRepository = await db!.repository.findFirstOrThrow({
      where: { ownerId: repositoryOwner.userId, normalizedName: 'expiredrestore' },
    });
    expect((await call('DELETE', 'repos/PrivateOwner/ExpiredRestore', repositoryOwner.cookie)).status).toBe(204);
    await db!.repository.update({
      where: { id: expiredRepository.id },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });
    const expiredTombstone = await db!.repository.findUniqueOrThrow({ where: { id: expiredRepository.id } });
    const restoreExpiredResponse = await call('POST', `admin/repositories/${expiredRepository.id}/restore`, admin.cookie);
    expect(restoreExpiredResponse.status).toBe(409);
    expect(await restoreExpiredResponse.json()).toMatchObject({ error: { code: 'RESTORE_EXPIRED' } });
    expect(await db!.repository.findUniqueOrThrow({ where: { id: expiredRepository.id } })).toMatchObject({
      status: 'DELETED', deletedAt: expiredTombstone.deletedAt, purgeAfter: expiredTombstone.purgeAfter,
    });
    expect(await db!.auditLog.count({ where: {
      actorId: admin.userId, targetId: expiredRepository.id, action: 'ADMIN_REPOSITORY_RESTORED',
    } })).toBe(0);

    const createdRepository = await call('POST', 'repositories', repositoryOwner.cookie, {
      name: 'AdminBoundary', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(createdRepository.status).toBe(201);
    const repository = await db!.repository.findFirstOrThrow({
      where: { ownerId: repositoryOwner.userId, normalizedName: 'adminboundary' },
    });
    const bare = join(storageRoot, repository.storageKey);
    const targetSha = runGit(['--git-dir', bare, 'rev-parse', 'refs/heads/main']);
    const blobSha = runGit(['--git-dir', bare, 'hash-object', '-w', '--stdin'], 'private source fixture\n');
    const treeSha = runGit(['--git-dir', bare, 'mktree'], `100644 blob ${blobSha}\tprivate.txt\n`);
    const sourceSha = runGit([
      '--git-dir', bare, '-c', 'user.name=Private Owner', '-c', 'user.email=private-owner@example.test',
      'commit-tree', treeSha, '-p', targetSha, '-m', 'Add private source fixture',
    ]);
    const sourceBranch = 'feature/admin-boundary';
    runGit(['--git-dir', bare, 'update-ref', `refs/heads/${sourceBranch}`, sourceSha]);

    const createdPull = await call('POST', 'repos/PrivateOwner/AdminBoundary/pulls', repositoryOwner.cookie, {
      title: 'Private source boundary', sourceBranch, targetBranch: 'main',
    });
    expect(createdPull.status).toBe(201);
    const { pullRequest } = await createdPull.json() as { pullRequest: {
      id: string; number: number; version: number; sourceSha: string; targetSha: string; storageGeneration: number;
    } };
    expect(await db!.repositoryMember.count({ where: { repositoryId: repository.id, userId: admin.userId } })).toBe(0);
    expect((await call('GET', 'repos/PrivateOwner/AdminBoundary/blob?path=private.txt', admin.cookie)).status).toBe(404);
    expect((await call('GET', `repos/PrivateOwner/AdminBoundary/pulls/${pullRequest.number}`, admin.cookie)).status).toBe(404);
    const mergeResponse = await call('POST', `repos/PrivateOwner/AdminBoundary/pulls/${pullRequest.number}/merge`, admin.cookie, {
      operationId: randomUUID(), expectedSourceSha: pullRequest.sourceSha, expectedTargetSha: pullRequest.targetSha,
      storageGeneration: pullRequest.storageGeneration, version: pullRequest.version,
    });
    expect(mergeResponse.status).toBe(404);
    expect(await db!.pullRequest.findUniqueOrThrow({ where: { id: pullRequest.id } })).toMatchObject({
      status: 'OPEN', mergeCommitSha: null, mergedById: null,
    });
    expect(await db!.pullRequestMergeOperation.count({ where: { pullRequestId: pullRequest.id } })).toBe(0);
    expect(runGit(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).toBe(targetSha);

    const tokenSecret = 'cfg_test_admin_audit_secret';
    const privateSource = 'private-source-audit-fixture';
    await db!.auditLog.create({ data: {
      actorId: repositoryOwner.userId, action: 'AUDIT_PRIVACY_FIX', targetId: repository.id,
      details: { repositoryId: repository.id, role: 'WRITE', token: tokenSecret, password: 'password-fixture', diff: privateSource },
    } });
    const auditResponse = await call('GET', 'admin/audit?action=AUDIT_PRIVACY_FIX', admin.cookie);
    expect(auditResponse.status).toBe(200);
    const auditBody = await auditResponse.json() as { audit: Array<{ details: Record<string, unknown> }> };
    expect(auditBody.audit).toHaveLength(1);
    expect(auditBody.audit[0]?.details).toEqual({ repositoryId: repository.id, role: 'WRITE' });
    expect(JSON.stringify(auditBody)).not.toContain(tokenSecret);
    expect(JSON.stringify(auditBody)).not.toContain('password-fixture');
    expect(JSON.stringify(auditBody)).not.toContain(privateSource);
  }, 60_000);

  it('repository status lock waits for an in-flight receive-pack before applying LOCKED', async () => {
    const adminRegistration = await call('POST', 'auth/register', '', {
      username: 'RepositoryStatusRaceAdmin', email: 'repository-status-race-admin@example.test', password,
    });
    expect(adminRegistration.status).toBe(201);
    const adminCookie = cookie(adminRegistration);
    const admin = await adminRegistration.json() as { user: { id: string } };
    await db!.user.update({ where: { id: admin.user.id }, data: { systemRole: 'ADMIN' } });
    const registerResponse = await call('POST', 'auth/register', '', {
      username: 'RepositoryStatusRaceOwner', email: 'repository-status-race-owner@example.test', password,
    });
    expect(registerResponse.status).toBe(201);
    const ownerCookie = cookie(registerResponse);
    const owner = await registerResponse.json() as { user: { id: string } };
    const repositoryResponse = await call('POST', 'repositories', ownerCookie, {
      name: 'RepositoryStatusPushRace', initializeReadme: true,
    });
    expect(repositoryResponse.status).toBe(201);
    const repositoryBody = await repositoryResponse.json() as { repository: { id: string } };
    const stored = await db!.repository.findUniqueOrThrow({ where: { id: repositoryBody.repository.id } });
    const bare = join(storageRoot, stored.storageKey);
    const tokenResponse = await call('POST', 'tokens', ownerCookie, {
      name: 'Repository status race', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(tokenResponse.status).toBe(201);
    const { secret, token } = await tokenResponse.json() as { secret: string; token: { id: string } };
    const work = join(storageRoot, 'repository-status-push-race-clone');
    const hookRoot = join(storageRoot, 'repository-status-push-race-hooks');
    const hookStarted = join(storageRoot, 'repository-status-push-race-hook-started');
    const hookRelease = join(storageRoot, 'repository-status-push-race-hook-release');
    const askpass = join(storageRoot, process.platform === 'win32'
      ? 'repository-status-push-race-askpass.cmd' : 'repository-status-push-race-askpass.sh');
    const run = promisify(execFile);
    await writeFile(askpass, process.platform === 'win32'
      ? '@echo off\r\necho %TEST_GIT_PAT%\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$TEST_GIT_PAT"\n', { mode: 0o700 });
    const git = (args: string[]) => run('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_PAT: secret },
    });
    const repoUrl = `${base.replace('http://', 'http://RepositoryStatusRaceOwner@')}/git/RepositoryStatusRaceOwner/RepositoryStatusPushRace.git`;
    const hookBarrier = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const refs = fs.readFileSync(0);
fs.writeFileSync(process.env.CODE_FORGE_TEST_HOOK_STARTED, 'started');
const deadline = Date.now() + 20_000;
while (!fs.existsSync(process.env.CODE_FORGE_TEST_HOOK_RELEASE)) {
  if (Date.now() >= deadline) process.exit(99);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
}
const result = spawnSync(process.execPath, [process.env.CODE_FORGE_TEST_REAL_HOOK], {
  input: refs, stdio: ['pipe', 'inherit', 'inherit'], env: process.env,
});
process.exit(result.status ?? 1);
`;
    await mkdir(hookRoot, { recursive: true });
    await writeFile(join(hookRoot, 'pre-receive'), hookBarrier, { mode: 0o755 });
    const realHook = resolve(__dirname, '../src/repositories/pre-receive-hook.cjs');
    const storage = app!.get(GitStorageService);
    const openPack = jest.spyOn(storage, 'openPack').mockImplementation((key, defaultBranch, service, advertise,
      protocol, actorIsOwner) => spawn('git', [
      ...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []),
      '-c', `http.receivepack=${service === 'git-receive-pack'}`,
      '-c', 'http.getanyfile=false',
      '-c', `http.uploadpack=${service !== 'git-receive-pack'}`,
      '-c', 'http.maxRequestBuffer=1048576',
      ...(service === 'git-receive-pack' ? ['-c', `core.hooksPath=${hookRoot}`, '-c', 'receive.denyNonFastForwards=true'] : []),
      'http-backend',
    ], {
      detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_PROJECT_ROOT: storageRoot, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${key}/${advertise ? 'info/refs' : service}`,
        REQUEST_METHOD: advertise ? 'GET' : 'POST', QUERY_STRING: advertise ? `service=${service}` : '',
        CONTENT_TYPE: advertise ? '' : `application/x-${service}-request`,
        ...(service === 'git-receive-pack' ? {
          CODE_FORGE_DEFAULT_BRANCH: defaultBranch,
          CODE_FORGE_ALLOW_DEFAULT_BRANCH_INITIALIZATION: String(actorIsOwner),
          CODE_FORGE_MAX_FILE_BYTES: String(Number(process.env.MAX_FILE_BYTES ?? 1024)),
          CODE_FORGE_MAX_REPOSITORY_BYTES: String(Number(process.env.MAX_REPOSITORY_BYTES ?? 32 * 1024)),
          CODE_FORGE_TEST_HOOK_STARTED: hookStarted,
          CODE_FORGE_TEST_HOOK_RELEASE: hookRelease,
          CODE_FORGE_TEST_REAL_HOOK: realHook,
        } : {}),
        ...(protocol ? { GIT_PROTOCOL: protocol } : {}),
      }, stdio: ['pipe', 'pipe', 'pipe'],
    }));

    const waitFor = async (predicate: () => boolean | Promise<boolean>, description: string) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    const applicationName = `admin-e2e-${schema.slice(-12)}`;
    let pushResult: Awaited<ReturnType<typeof git>> | undefined;
    let pushError: unknown;
    let statusResponse: Response | undefined;
    let statusError: unknown;
    let pushPromise: Promise<void> | undefined;
    let statusPromise: Promise<void> | undefined;
    try {
      await git(['clone', repoUrl, work]);
      await git(['-C', work, 'config', 'user.name', 'Repository Status Race Tester']);
      await git(['-C', work, 'config', 'user.email', 'repository-status-race@example.test']);
      await git(['-C', work, 'switch', '-c', 'feature/repository-status-before-lock']);
      await writeFile(join(work, 'status-race.txt'), 'push completes before repository lock\n');
      await git(['-C', work, 'add', 'status-race.txt']);
      await git(['-C', work, 'commit', '-m', 'Push before repository status lock']);
      const pushedSha = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();

      pushPromise = git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/repository-status-before-lock'])
        .then((result) => { pushResult = result; }, (error) => { pushError = error; });
      await waitFor(() => existsSync(hookStarted), 'receive-pack to enter pre-receive');

      statusPromise = call('PATCH', `admin/repositories/${stored.id}/status`, adminCookie, { status: 'LOCKED' })
        .then((response) => { statusResponse = response; }, (error) => { statusError = error; });
      await waitFor(async () => {
        const rows = await adminDb!.$queryRawUnsafe<{ waiting: number }[]>(`
          WITH lock_key AS (SELECT hashtextextended($2, 0) AS value)
          SELECT COUNT(DISTINCT activity.pid)::int AS waiting
          FROM pg_stat_activity AS activity
          JOIN pg_locks AS pg_lock ON pg_lock.pid = activity.pid
          CROSS JOIN lock_key
          WHERE activity.application_name = $1
            AND activity.wait_event_type = 'Lock'
            AND activity.wait_event = 'advisory'
            AND pg_lock.locktype = 'advisory'
            AND pg_lock.granted = false
            AND pg_lock.classid = ((lock_key.value >> 32) & 4294967295)::oid
            AND pg_lock.objid = (lock_key.value & 4294967295)::oid
            AND pg_lock.objsubid = 1`, applicationName, stored.id);
        return (rows[0]?.waiting ?? 0) >= 1;
      }, 'admin repository status lock to queue behind receive-pack');
      expect(statusResponse).toBeUndefined();

      await writeFile(hookRelease, 'release');
      await pushPromise;
      expect(pushError).toBeUndefined();
      expect(pushResult).toBeDefined();
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/feature/repository-status-before-lock'], { encoding: 'utf8' }).trim())
        .toBe(pushedSha);

      await statusPromise;
      expect(statusError).toBeUndefined();
      expect(statusResponse).toBeDefined();
      expect(statusResponse!.status).toBe(200);
      expect(await statusResponse!.json()).toMatchObject({ changed: true, repository: { id: stored.id, status: 'LOCKED' } });
      expect(await db!.repository.findUniqueOrThrow({ where: { id: stored.id }, select: { status: true } }))
        .toMatchObject({ status: 'LOCKED' });

      const operations = await db!.gitPushOperation.findMany({ where: { repositoryId: stored.id, actorId: owner.user.id } });
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({ status: 'COMPLETED', changedRefCount: 1, errorCode: null });
      const pushAudits = await db!.auditLog.findMany({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } });
      expect(pushAudits).toHaveLength(1);
      expect(pushAudits[0]).toMatchObject({ actorId: owner.user.id, details: {
        operationId: operations[0]!.operationId, repositoryId: stored.id, storageGeneration: stored.storageGeneration, changedRefCount: 1,
      } });
      const lockAudits = await db!.auditLog.findMany({ where: { targetId: stored.id, action: 'ADMIN_REPOSITORY_LOCKED' } });
      expect(lockAudits).toHaveLength(1);
      expect(lockAudits[0]).toMatchObject({ actorId: admin.user.id, details: { from: 'ACTIVE', to: 'LOCKED' } });

      const refsAfterPush = execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' });
      const rejectedAdvertisement = await fetch(`${base}/git/RepositoryStatusRaceOwner/RepositoryStatusPushRace.git/info/refs?service=git-receive-pack`, {
        headers: { Authorization: `Basic ${Buffer.from(`RepositoryStatusRaceOwner:${secret}`).toString('base64')}` },
      });
      expect(rejectedAdvertisement.status).toBe(404);
      await writeFile(join(work, 'after-lock.txt'), 'must remain local\n');
      await git(['-C', work, 'add', 'after-lock.txt']);
      await git(['-C', work, 'commit', '-m', 'Attempt push after repository status lock']);
      await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/feature/after-repository-lock'])).rejects.toBeDefined();
      expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' }))
        .toBe(refsAfterPush);
      expect(await db!.gitPushOperation.count({ where: { repositoryId: stored.id, actorId: owner.user.id } })).toBe(1);
      expect(await db!.auditLog.count({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } })).toBe(1);
    } finally {
      if (!existsSync(hookRelease)) await writeFile(hookRelease, 'release').catch(() => undefined);
      if (pushPromise) await pushPromise.catch(() => undefined);
      if (statusPromise) await statusPromise.catch(() => undefined);
      openPack.mockRestore();
      await db!.personalAccessToken.deleteMany({ where: { id: token.id, userId: owner.user.id } });
      await db!.repository.deleteMany({ where: { id: stored.id } });
    }
  }, 60_000);

  it('serializes concurrent attempts to lock the last two active administrators', async () => {
    const previousAdmin = adminAccount;
    const registerAdmin = async (username: string) => {
      const response = await call('POST', 'auth/register', '', {
        username, email: `${username.toLowerCase()}@example.test`, password,
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { user: { id: string } };
      const account = { userId: body.user.id, cookie: cookie(response) };
      await db!.user.update({ where: { id: account.userId }, data: { systemRole: 'ADMIN' } });
      return account;
    };
    const firstAdmin = previousAdmin ?? await registerAdmin('RaceAdminOne');
    const secondAdmin = await registerAdmin('RaceAdminTwo');

    const applicationName = `admin-e2e-${schema.slice(-12)}`;
    const barrierKey = `admin-last-admin-${schema.slice(-12)}`;
    const functionName = `pause_admin_lock_${schema.slice(-12)}`;
    const triggerName = `pause_admin_lock_${schema.slice(-12)}`;
    const barrier = new Client({ connectionString: originalDatabaseUrl, connectionTimeoutMillis: 5_000 });
    let barrierConnected = false;
    let barrierHeld = false;
    let functionCreated = false;
    let triggerCreated = false;
    let firstRequest: Promise<{ status: number; body: unknown }> | undefined;
    let secondRequest: Promise<{ status: number; body: unknown }> | undefined;

    const waitForActivity = async (
      predicate: () => Promise<boolean>, description: string,
    ) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };

    try {
      await barrier.connect();
      barrierConnected = true;
      await barrier.query("SET statement_timeout = '30s'");
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [barrierKey]);
      barrierHeld = true;

      await adminDb!.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.system_role = 'ADMIN' AND OLD.status = 'ACTIVE' AND NEW.status = 'LOCKED' THEN
            PERFORM pg_advisory_lock(hashtextextended('${barrierKey}', 0));
            PERFORM pg_advisory_unlock(hashtextextended('${barrierKey}', 0));
          END IF;
          RETURN NEW;
        END;
      $$`);
      functionCreated = true;
      await adminDb!.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF status ON "${schema}".users
        FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);
      triggerCreated = true;

      const appActivity = () => adminDb!.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${applicationName}`;

      firstRequest = call('PATCH', `admin/users/${secondAdmin.userId}/status`, firstAdmin.cookie, { status: 'LOCKED' })
        .then(async (response) => ({ status: response.status, body: await response.json() as Record<string, unknown> }));
      let firstPid: number | undefined;
      const barrierPidResult = await barrier.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const barrierPid = barrierPidResult.rows[0]?.pid;
      if (!barrierPid) throw new Error('Could not identify the PostgreSQL test barrier connection.');
      await waitForActivity(async () => {
        const rows = await appActivity();
        const appPids = rows.map(({ pid }) => pid);
        if (appPids.length === 0) return false;
        const waiting = await adminDb!.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = ${applicationName}
            AND wait_event_type = 'Lock' AND wait_event = 'advisory'
            AND query ILIKE '%UPDATE%users%'
            AND pg_blocking_pids(pid) @> ARRAY[${barrierPid}::int]`;
        if (waiting.length === 1) { firstPid = waiting[0]!.pid; return true; }
        return false;
      }, 'first admin transaction to reach the PostgreSQL lock barrier');

      secondRequest = call('PATCH', `admin/users/${firstAdmin.userId}/status`, secondAdmin.cookie, { status: 'LOCKED' })
        .then(async (response) => ({ status: response.status, body: await response.json() as Record<string, unknown> }));
      await waitForActivity(async () => {
        const rows = await adminDb!.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = ${applicationName}
            AND wait_event_type = 'Lock' AND wait_event <> 'advisory'
            AND query ILIKE '%SELECT id FROM users WHERE system_role%'
            AND pg_blocking_pids(pid) @> ARRAY[${firstPid ?? -1}::int]`;
        return rows.length === 1;
      }, 'second admin transaction to queue behind the first admin-row lock');

      const unlocked = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [barrierKey]);
      expect(unlocked.rows[0]?.pg_advisory_unlock).toBe(true);
      barrierHeld = false;

      const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);
      expect(firstResult.status).toBe(200);
      expect(firstResult.body).toMatchObject({ changed: true, user: { id: secondAdmin.userId, status: 'LOCKED' } });
      expect(secondResult.status).toBe(409);
      expect(secondResult.body).toMatchObject({ error: { code: 'LAST_ACTIVE_ADMIN' } });

      expect(await db!.user.count({ where: { systemRole: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
      expect(await db!.user.findUniqueOrThrow({ where: { id: firstAdmin.userId }, select: { status: true } }))
        .toMatchObject({ status: 'ACTIVE' });
      expect(await db!.user.findUniqueOrThrow({ where: { id: secondAdmin.userId }, select: { status: true } }))
        .toMatchObject({ status: 'LOCKED' });
      expect(await db!.auditLog.count({ where: { action: 'ADMIN_USER_LOCKED', targetId: { in: [firstAdmin.userId, secondAdmin.userId] } } }))
        .toBe(1);
    } finally {
      if (barrierHeld && barrierConnected) {
        await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [barrierKey]).catch(() => undefined);
        barrierHeld = false;
      }
      if (firstRequest || secondRequest) await Promise.allSettled([firstRequest, secondRequest].filter(Boolean) as Promise<unknown>[]);
      if (triggerCreated) await adminDb!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}".users`).catch(() => undefined);
      if (functionCreated) await adminDb!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`).catch(() => undefined);
      await db!.user.update({ where: { id: secondAdmin.userId }, data: { systemRole: 'USER', status: 'ACTIVE', lockedAt: null } }).catch(() => undefined);
      if (barrierConnected) await barrier.end().catch(() => undefined);
    }
  }, 60_000);

  it('serializes racing login and refresh against account lock before unlock', async () => {
    const register = async (username: string) => {
      const response = await call('POST', 'auth/register', '', {
        username, email: `${username.toLowerCase()}@example.test`, password,
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { user: { id: string } };
      return { userId: body.user.id, cookie: cookie(response) };
    };
    const admin = await register('AccountRaceAdmin');
    await db!.user.update({ where: { id: admin.userId }, data: { systemRole: 'ADMIN' } });

    const waitForBlockedQuery = async (fragment: string) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const rows = await adminDb!.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND position(${fragment} in query) > 0
          ) AS waiting`;
        if (rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for a PostgreSQL lock wait on query fragment: ${fragment}`);
    };

    const raceLockAgainst = async (username: string, operation: 'login' | 'refresh') => {
      const account = await register(username);
      let releaseRowLock!: () => void;
      let rowLockAcquired!: () => void;
      const acquired = new Promise<void>((resolve) => { rowLockAcquired = resolve; });
      const keepLocked = new Promise<void>((resolve) => { releaseRowLock = resolve; });
      const rowLock = db!.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${account.userId}::uuid FOR UPDATE`;
        rowLockAcquired();
        await keepLocked;
      });
      await acquired;

      let lockRequest: Promise<Response> | undefined;
      let operationRequest: Promise<Response> | undefined;
      try {
        lockRequest = call('PATCH', `admin/users/${account.userId}/status`, admin.cookie, { status: 'LOCKED' });
        await waitForBlockedQuery('SELECT id FROM users WHERE id =');
        operationRequest = operation === 'login'
          ? call('POST', 'auth/login', '', { login: username, password })
          : call('POST', 'auth/refresh', account.cookie);
        await waitForBlockedQuery('SELECT status FROM users');
      } finally {
        releaseRowLock();
        await rowLock;
      }

      const [lockResponse, resultResponse] = await Promise.all([lockRequest, operationRequest]);
      expect(lockResponse.status).toBe(200);
      expect(resultResponse.status).toBe(403);
      expect(await db!.session.count({ where: { userId: account.userId, revokedAt: null } })).toBe(0);

      const unlock = await call('PATCH', `admin/users/${account.userId}/status`, admin.cookie, { status: 'ACTIVE' });
      expect(unlock.status).toBe(200);
      expect((await call('GET', 'auth/me', account.cookie)).status).toBe(401);
      expect(await db!.session.count({ where: { userId: account.userId, revokedAt: null } })).toBe(0);
      if (operation === 'refresh') {
        expect((await call('POST', 'auth/refresh', account.cookie)).status).toBe(401);
      }
    };

    await raceLockAgainst('LoginRaceUser', 'login');
    await raceLockAgainst('RefreshRaceUser', 'refresh');
  }, 60_000);
});

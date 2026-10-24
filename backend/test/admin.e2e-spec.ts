import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
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
    process.env.DATABASE_URL = isolatedUrl.toString();
    process.env.DATABASE_URL_UNPOOLED = isolatedUrl.toString();
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });

    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    const lockedUser = await register('LockedMember');
    const repositoryOwner = await register('PrivateOwner');
    await db!.user.update({ where: { id: admin.userId }, data: { systemRole: 'ADMIN' } });

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
});

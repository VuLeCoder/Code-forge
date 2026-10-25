import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
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
    const admin = adminAccount;
    if (!admin) throw new Error('Admin account fixture was not created by the preceding admin acceptance test.');

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

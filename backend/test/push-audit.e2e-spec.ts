import { randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { MaintenanceJobsService } from '../src/maintenance/maintenance-jobs.service';
// cookie-parser is CommonJS; its default import is undefined at runtime in this test runner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');

const requireFromBackend = createRequire(__filename);
const runGit = promisify(execFile);

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

describe('Git push audit HTTP + PostgreSQL + Git', () => {
  const schema = `git_push_audit_test_${randomBytes(8).toString('hex')}`;
  let admin: PrismaClient;
  let db: PrismaClient;
  let app: INestApplication;
  let base: string;
  let origin: string;
  let ownerCookie: string;
  let originalUrl: string | undefined;
  let originalUnpooledUrl: string | undefined;
  let originalStorage: string | undefined;
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
    await ConfigModule.forRoot({ envFilePath: '.env' });
    originalUrl = process.env.DATABASE_URL;
    originalUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
    originalStorage = process.env.GIT_STORAGE_PATH;
    if (!originalUrl) throw new Error('DATABASE_URL is required for integration tests');
    const targetDatabase = new URL(originalUrl);
    const databaseName = decodeURIComponent(targetDatabase.pathname.replace(/^\/+/, ''));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(targetDatabase.hostname) || !databaseName.endsWith('_test')) {
      throw new Error('Git push audit E2E requires a loopback PostgreSQL database whose name ends in _test.');
    }

    storageRoot = await mkdtemp(join(tmpdir(), 'code-forge-push-audit-'));
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
    if (admin) {
      if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
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

  it('journals the exact authenticated ref update and never audits a rejected read-only push as success', async () => {
    const registered = await call('POST', 'auth/register', {
      username: 'PushAuditOwner', email: 'push-audit-owner@example.test', password: 'test-password-123',
    }, '');
    expect(registered.status).toBe(201);
    ownerCookie = cookie(registered);
    const owner = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'pushauditowner' } });

    const createdRepo = await call('POST', 'repositories', {
      name: 'PushAuditDemo', visibility: 'PUBLIC', initializeReadme: true,
    });
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);

    const ownerTokenResponse = await call('POST', 'tokens', {
      name: 'Push audit owner', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(ownerTokenResponse.status).toBe(201);
    const ownerToken = await responseJson<{ token: { id: string }; secret: string }>(ownerTokenResponse);

    const readOnlyTokenResponse = await call('POST', 'tokens', {
      name: 'Push audit read only', scopes: ['repo:read'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(readOnlyTokenResponse.status).toBe(201);
    const readOnlyToken = await responseJson<{ token: { id: string }; secret: string }>(readOnlyTokenResponse);

    const askpass = join(storageRoot, process.platform === 'win32' ? 'git-askpass.cmd' : 'git-askpass.sh');
    await writeFile(askpass, process.platform === 'win32'
      ? '@echo off\r\necho %TEST_GIT_PAT%\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$TEST_GIT_PAT"\n', { mode: 0o700 });
    const git = (token: string, args: string[]) => runGit('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_PAT: token },
    });
    const repoUrl = `${base.replace('http://', 'http://PushAuditOwner@')}/git/PushAuditOwner/PushAuditDemo.git`;
    const work = join(storageRoot, 'owner-clone');
    await git(ownerToken.secret, ['clone', repoUrl, work]);
    await git(ownerToken.secret, ['-C', work, 'config', 'user.name', 'Push Audit Owner']);
    await git(ownerToken.secret, ['-C', work, 'config', 'user.email', 'push-audit-owner@example.test']);
    const initialRefsOutput = (await git(ownerToken.secret, ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/'])).stdout.trim();
    const beforeRefs = Object.fromEntries(initialRefsOutput ? initialRefsOutput.split('\n').map((line) => {
      const [name, sha] = line.split(' ');
      return [name!, sha!];
    }) : []);

    await git(ownerToken.secret, ['-C', work, 'switch', '-c', 'feature/audited-push']);
    await writeFile(join(work, 'audited.txt'), 'push journal acceptance\n');
    await git(ownerToken.secret, ['-C', work, 'add', 'audited.txt']);
    await git(ownerToken.secret, ['-C', work, 'commit', '-m', 'Add audited file']);
    const expectedSha = (await git(ownerToken.secret, ['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(ownerToken.secret, ['-C', work, 'push', '--set-upstream', 'origin', 'feature/audited-push']);

    const refsAfterPush = (await git(ownerToken.secret, ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/'])).stdout.trim();
    const actualRefsAfterPush = Object.fromEntries(refsAfterPush.split('\n').map((line) => {
      const [name, sha] = line.split(' ');
      return [name!, sha!];
    }));
    expect(actualRefsAfterPush['refs/heads/feature/audited-push']).toBe(expectedSha);

    const operations = await db.$queryRaw<{
      operation_id: string; repository_id: string; actor_id: string; storage_generation: number;
      status: string; before_refs: Record<string, string> | null; changed_ref_count: number;
    }[]>`SELECT operation_id, repository_id, actor_id, storage_generation, status, before_refs, changed_ref_count
      FROM git_push_operations WHERE repository_id = ${repository.id}::uuid ORDER BY created_at ASC`;
    expect(operations).toHaveLength(1);
    const operation = operations[0]!;
    expect(operation).toMatchObject({ repository_id: repository.id, actor_id: owner.id,
      storage_generation: storedRepo.storageGeneration, status: 'COMPLETED', changed_ref_count: 1 });
    expect(operation.before_refs).toBeNull();
    expect(beforeRefs['refs/heads/feature/audited-push']).toBeUndefined();

    const successAudits = await db.$queryRaw<{
      actor_id: string; action: string; target_id: string; details: Record<string, unknown>;
    }[]>`SELECT actor_id, action, target_id, details FROM audit_logs
      WHERE action = 'GIT_PUSH_COMPLETED' AND details->>'repositoryId' = ${repository.id}`;
    expect(successAudits).toHaveLength(1);
    expect(successAudits[0]).toMatchObject({ actor_id: owner.id, action: 'GIT_PUSH_COMPLETED', target_id: repository.id,
      details: { operationId: operation.operation_id, repositoryId: repository.id,
        storageGeneration: storedRepo.storageGeneration, changedRefCount: 1 } });
    expect(Object.keys(successAudits[0]!.details).sort()).toEqual(['changedRefCount', 'operationId', 'repositoryId', 'storageGeneration']);
    expect(JSON.stringify(successAudits[0]!.details)).not.toContain(ownerToken.secret);
    expect(JSON.stringify(successAudits[0]!.details)).not.toContain(readOnlyToken.secret);
    expect(JSON.stringify(successAudits[0]!.details)).not.toContain(expectedSha);

    // One receive-pack updates an existing branch and creates another branch.
    await git(ownerToken.secret, ['-C', work, 'switch', '-c', 'feature/multi-ref-created']);
    await git(ownerToken.secret, ['-C', work, 'switch', 'feature/audited-push']);
    await writeFile(join(work, 'multi-ref-update.txt'), 'update one ref while creating another\n');
    await git(ownerToken.secret, ['-C', work, 'add', 'multi-ref-update.txt']);
    await git(ownerToken.secret, ['-C', work, 'commit', '-m', 'Update first ref']);
    const updatedFirstRefSha = (await git(ownerToken.secret, ['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(ownerToken.secret, ['-C', work, 'push', 'origin', 'feature/audited-push', 'feature/multi-ref-created']);

    const refsAfterMultiRefPushOutput = (await git(ownerToken.secret,
      ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'])).stdout.trim();
    const refsAfterMultiRefPush = Object.fromEntries(refsAfterMultiRefPushOutput.split('\n').map((line) => {
      const [name, sha] = line.split(' ');
      return [name!, sha!];
    }));
    expect(refsAfterMultiRefPush['refs/heads/feature/audited-push']).toBe(updatedFirstRefSha);
    expect(refsAfterMultiRefPush['refs/heads/feature/multi-ref-created']).toBe(expectedSha);

    const afterMultiRefOperations = await db.$queryRaw<{
      operation_id: string; status: string; changed_ref_count: number | null;
    }[]>`SELECT operation_id, status, changed_ref_count FROM git_push_operations
      WHERE repository_id = ${repository.id}::uuid ORDER BY created_at ASC`;
    expect(afterMultiRefOperations).toHaveLength(2);
    expect(afterMultiRefOperations[1]).toMatchObject({ status: 'COMPLETED', changed_ref_count: 2 });
    expect(await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'GIT_PUSH_COMPLETED' AND details->>'repositoryId' = ${repository.id}`)
      .toEqual([{ count: 2n }]);

    // A single push also counts both a branch update and deletion as ref changes.
    await writeFile(join(work, 'delete-ref-update.txt'), 'update the retained branch and delete another ref\n');
    await git(ownerToken.secret, ['-C', work, 'add', 'delete-ref-update.txt']);
    await git(ownerToken.secret, ['-C', work, 'commit', '-m', 'Update branch while deleting another']);
    const updatedRetainedRefSha = (await git(ownerToken.secret, ['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(ownerToken.secret, ['-C', work, 'push', 'origin', 'feature/audited-push', ':feature/multi-ref-created']);

    const refsAfterUpdateAndDeleteOutput = (await git(ownerToken.secret,
      ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/'])).stdout.trim();
    const refsAfterUpdateAndDelete = Object.fromEntries(refsAfterUpdateAndDeleteOutput.split('\n').map((line) => {
      const [name, sha] = line.split(' ');
      return [name!, sha!];
    }));
    expect(refsAfterUpdateAndDelete['refs/heads/feature/audited-push']).toBe(updatedRetainedRefSha);
    expect(refsAfterUpdateAndDelete['refs/heads/feature/multi-ref-created']).toBeUndefined();

    const afterDeleteOperations = await db.$queryRaw<{
      operation_id: string; status: string; changed_ref_count: number | null;
    }[]>`SELECT operation_id, status, changed_ref_count FROM git_push_operations
      WHERE repository_id = ${repository.id}::uuid ORDER BY created_at ASC`;
    expect(afterDeleteOperations).toHaveLength(3);
    expect(afterDeleteOperations[2]).toMatchObject({ status: 'COMPLETED', changed_ref_count: 2 });
    const successAuditsAfterDelete = await db.$queryRaw<{
      details: Record<string, unknown>;
    }[]>`SELECT details FROM audit_logs WHERE action = 'GIT_PUSH_COMPLETED'
      AND details->>'repositoryId' = ${repository.id}`;
    expect(successAuditsAfterDelete).toHaveLength(3);
    expect(successAuditsAfterDelete.map(({ details }) => details.operationId).sort()).toEqual(
      afterDeleteOperations.map(({ operation_id }) => operation_id).sort());
    for (const audit of successAuditsAfterDelete) {
      expect(Object.keys(audit.details).sort()).toEqual(['changedRefCount', 'operationId', 'repositoryId', 'storageGeneration']);
      expect(JSON.stringify(audit.details)).not.toContain(ownerToken.secret);
      expect(JSON.stringify(audit.details)).not.toContain(readOnlyToken.secret);
      expect(JSON.stringify(audit.details)).not.toContain(expectedSha);
      expect(JSON.stringify(audit.details)).not.toContain(updatedFirstRefSha);
      expect(JSON.stringify(audit.details)).not.toContain(updatedRetainedRefSha);
    }

    await git(readOnlyToken.secret, ['-C', work, 'switch', '-c', 'feature/rejected-push']);
    await writeFile(join(work, 'rejected.txt'), 'must not be accepted\n');
    await git(readOnlyToken.secret, ['-C', work, 'add', 'rejected.txt']);
    await git(readOnlyToken.secret, ['-C', work, 'commit', '-m', 'Try read-only push']);
    await expect(git(readOnlyToken.secret, ['-C', work, 'push', '--set-upstream', 'origin', 'feature/rejected-push'])).rejects.toBeDefined();

    const auditsAfterRejectedPush = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'GIT_PUSH_COMPLETED' AND details->>'repositoryId' = ${repository.id}`;
    expect(auditsAfterRejectedPush[0]!.count).toBe(3n);
    const refsAfterRejectedPush = (await git(ownerToken.secret, ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'])).stdout.trim();
    expect(refsAfterRejectedPush).not.toContain('feature/rejected-push');

    const triggerName = `fail_push_audit_${schema.slice(-12)}`;
    const functionName = `${triggerName}_fn`;
    let interruptedOperationId: string | undefined;
    try {
      await admin.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'GIT_PUSH_COMPLETED' AND NEW.target_id = '${repository.id}'::uuid THEN
            RAISE EXCEPTION 'intentional isolated push audit failure';
          END IF;
          RETURN NEW;
        END $$`);
      await admin.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${schema}"."audit_logs"
        FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`);
      await git(ownerToken.secret, ['-C', work, 'switch', '-c', 'feature/reconcile-audit-failure']);
      await writeFile(join(work, 'reconcile-audit.txt'), 'ref update survives audit transaction failure\n');
      await git(ownerToken.secret, ['-C', work, 'add', 'reconcile-audit.txt']);
      await git(ownerToken.secret, ['-C', work, 'commit', '-m', 'Exercise push journal reconciliation']);
      const interruptedSha = (await git(ownerToken.secret, ['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
      await expect(git(ownerToken.secret, ['-C', work, 'push', '--set-upstream', 'origin', 'feature/reconcile-audit-failure'])).rejects.toBeDefined();

      expect((await git(ownerToken.secret, ['--git-dir', bare, 'rev-parse', 'refs/heads/feature/reconcile-audit-failure'])).stdout.trim())
        .toBe(interruptedSha);
      const interruptedRows = await db.$queryRaw<{
        operation_id: string; status: string; storage_generation: number; before_refs: Record<string, string> | null; changed_ref_count: number | null;
      }[]>`SELECT operation_id, status, storage_generation, before_refs, changed_ref_count FROM git_push_operations
        WHERE repository_id = ${repository.id}::uuid AND status IN ('PENDING', 'NEEDS_RECONCILIATION')
        ORDER BY created_at DESC LIMIT 1`;
      expect(interruptedRows).toHaveLength(1);
      interruptedOperationId = interruptedRows[0]!.operation_id;
      expect(interruptedRows[0]).toMatchObject({ status: 'NEEDS_RECONCILIATION',
        storage_generation: storedRepo.storageGeneration, changed_ref_count: null });
      expect(interruptedRows[0]!.before_refs).toEqual(refsAfterUpdateAndDelete);
      const auditsBeforeReconcile = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM audit_logs
        WHERE action = 'GIT_PUSH_COMPLETED' AND details->>'repositoryId' = ${repository.id}
          AND details->>'operationId' = ${interruptedOperationId}`;
      expect(auditsBeforeReconcile[0]!.count).toBe(0n);

      const refsBeforeBlockedPush = (await git(ownerToken.secret, ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'])).stdout;
      await expect(git(ownerToken.secret, ['-C', work, 'push', 'origin', 'feature/reconcile-audit-failure:refs/heads/feature/blocked-push']))
        .rejects.toBeDefined();
      const refsAfterBlockedPush = (await git(ownerToken.secret, ['--git-dir', bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'])).stdout;
      expect(refsAfterBlockedPush).toBe(refsBeforeBlockedPush);
      const operationsWhileBlocked = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM git_push_operations
        WHERE repository_id = ${repository.id}::uuid`;
      expect(operationsWhileBlocked[0]!.count).toBe(4n);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."audit_logs"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`);
    }

    if (!interruptedOperationId) throw new Error('Push operation was not journaled for reconciliation.');
    await db.$executeRaw`UPDATE git_push_operations SET created_at = NOW() - INTERVAL '121 seconds'
      WHERE operation_id = ${interruptedOperationId}::uuid AND repository_id = ${repository.id}::uuid`;
    const maintenance = app.get(MaintenanceJobsService);
    let completedAfterReconcile: { status: string; changed_ref_count: number | null }[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await maintenance.runOnce();
      completedAfterReconcile = await db.$queryRaw<{ status: string; changed_ref_count: number | null }[]>`SELECT status, changed_ref_count
        FROM git_push_operations WHERE operation_id = ${interruptedOperationId}::uuid`;
      if (completedAfterReconcile[0]?.status === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(completedAfterReconcile).toMatchObject([{ status: 'COMPLETED', changed_ref_count: 1 }]);
    const recoveredAudits = await db.$queryRaw<{ actor_id: string; details: Record<string, unknown> }[]>`SELECT actor_id, details FROM audit_logs
      WHERE action = 'GIT_PUSH_COMPLETED' AND details->>'repositoryId' = ${repository.id}
        AND details->>'operationId' = ${interruptedOperationId}`;
    expect(recoveredAudits).toHaveLength(1);
    expect(recoveredAudits[0]).toMatchObject({ actor_id: owner.id, details: { operationId: interruptedOperationId,
      repositoryId: repository.id, storageGeneration: storedRepo.storageGeneration, changedRefCount: 1 } });
  }, 60_000);
});

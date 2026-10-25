import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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

  it('creates, compares, and owner-merges a PR while preserving both Git parents', async () => {
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

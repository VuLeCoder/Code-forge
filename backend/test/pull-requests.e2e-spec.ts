import { randomBytes, randomUUID } from 'node:crypto';
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
// cookie-parser is CommonJS; its default import is undefined at runtime in this test runner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');

const requireFromBackend = createRequire(__filename);

async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
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

    // Exercise the shared repository lock across two different lifecycle mutations.
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
    const { token } = await responseJson<{ token: { secret: string } }>(tokenResponse);

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

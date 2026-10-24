import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
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
  let originalUrl: string | undefined;
  let originalUnpooledUrl: string | undefined;
  let originalStorage: string | undefined;
  let storageRoot: string;
  let schemaCreated = false;

  const cookie = (response: Response) => response.headers.getSetCookie()
    .map((value) => value.split(';')[0]).join('; ');
  const call = (method: string, path: string, body?: unknown) => fetch(`${base}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(ownerCookie ? { Cookie: ownerCookie } : {}) },
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

    const createdRepo = await call('POST', 'repositories', {
      name: 'PullDemo', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(createdRepo.status).toBe(201);
    const { repository } = await responseJson<{ repository: { id: string } }>(createdRepo);
    const storedRepo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, storedRepo.storageKey);
    const git = (args: string[], input?: string) => execFileSync('git', ['--git-dir', bare, ...args], {
      encoding: 'utf8', ...(input === undefined ? {} : { input }),
    }).trim();

    // Seed a feature commit directly in this test-owned bare repository. This bypasses
    // receive-pack only for deterministic fixture setup; all PR behavior below uses HTTP.
    const targetSha = git(['rev-parse', 'refs/heads/main']);
    const readmeSha = git(['rev-parse', `${targetSha}:README.md`]);
    const featureBlob = git(['hash-object', '-w', '--stdin'], 'button: enabled\n');
    const featureTree = git(['mktree'], `100644 blob ${readmeSha}\tREADME.md\n100644 blob ${featureBlob}\tfeature.txt\n`);
    const sourceSha = execFileSync('git', ['--git-dir', bare, '-c', 'user.name=Test', '-c', 'user.email=test@example.test',
      'commit-tree', featureTree, '-p', targetSha, '-m', 'Add feature'], { encoding: 'utf8' }).trim();
    git(['update-ref', 'refs/heads/feature/add-button', sourceSha]);

    const repoPath = 'repos/pullowner/pulldemo/pulls';
    const created = await call('POST', repoPath, {
      title: 'Add feature', description: 'Exercise the server-backed PR flow.',
      sourceBranch: 'feature/add-button', targetBranch: 'main',
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

    const operationId = randomUUID();
    const mergeRequest = { operationId, expectedSourceSha: sourceSha, expectedTargetSha: targetSha,
      storageGeneration: storedRepo.storageGeneration, version: detail.pullRequest.version };
    const [mergedResponse, concurrentReplayResponse] = await Promise.all([
      call('POST', `${repoPath}/${number}/merge`, mergeRequest),
      call('POST', `${repoPath}/${number}/merge`, mergeRequest),
    ]);
    expect(mergedResponse.status).toBe(200);
    const merged = await responseJson<{ status: string; operationId: string; mergeCommitSha: string }>(mergedResponse);
    expect(concurrentReplayResponse.status).toBe(200);
    expect(await responseJson(concurrentReplayResponse)).toMatchObject({
      status: 'MERGED', operationId, mergeCommitSha: merged.mergeCommitSha,
    });
    expect(merged.status).toBe('MERGED');
    expect(merged.mergeCommitSha).toMatch(/^[a-f0-9]{40,64}$/);
    expect(git(['rev-parse', 'refs/heads/main'])).toBe(merged.mergeCommitSha);
    const parents = git(['rev-list', '--parents', '-n', '1', merged.mergeCommitSha]).split(' ');
    expect(parents).toHaveLength(3);
    expect(parents.slice(1).sort()).toEqual([targetSha, sourceSha].sort());

    const finalDetail = await responseJson<{ pullRequest: { status: string; mergeCommitSha: string };
      mergeOperation: { status: string } }>(await call('GET', `${repoPath}/${number}`));
    expect(finalDetail.pullRequest).toMatchObject({ status: 'MERGED', mergeCommitSha: merged.mergeCommitSha });
    expect(finalDetail.mergeOperation).toMatchObject({ status: 'COMPLETED' });
    expect(await db.auditLog.count({ where: { targetId: detail.pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(1);

    const replay = await call('POST', `${repoPath}/${number}/merge`, {
      operationId, expectedSourceSha: sourceSha, expectedTargetSha: targetSha,
      storageGeneration: storedRepo.storageGeneration, version: detail.pullRequest.version,
    });
    expect(replay.status).toBe(200);
    expect(await responseJson(replay)).toMatchObject({ status: 'MERGED', mergeCommitSha: merged.mergeCommitSha });
    expect(git(['rev-parse', 'refs/heads/main'])).toBe(merged.mergeCommitSha);
    expect(await db.auditLog.count({ where: { targetId: detail.pullRequest.id, action: 'PULL_REQUEST_MERGED' } })).toBe(1);
  }, 60_000);
});

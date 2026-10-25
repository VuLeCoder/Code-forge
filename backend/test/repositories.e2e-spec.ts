import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import cookieParser = require('cookie-parser');
import { GitPushJournalService } from '../src/repositories/git-push-journal.service';
import { RepositoryPurgeService } from '../src/repositories/repository-purge.service';
import { GitStorageService } from '../src/repositories/git-storage.service';

function assertLoopbackTestDatabase(connectionString: string, variableName: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !databaseName.endsWith('_test')) {
    throw new Error(`${variableName} must target a loopback PostgreSQL database whose name ends in _test.`);
  }
}

describe('Repository HTTP + PostgreSQL', () => {
  const schema = `repo_test_${randomBytes(8).toString('hex')}`;
  let db: PrismaClient;
  let admin: PrismaClient;
  let schemaCreated = false;
  let app: INestApplication;
  let base: string;
  let origin: string;
  let ownerCookie: string;
  let otherCookie: string;
  let ownerId: string;
  let originalUrl: string | undefined;
  let originalUrlUnpooled: string | undefined;
  let originalQuota: string | undefined;
  let originalRetention: string | undefined;
  let originalStorage: string | undefined;
  let originalMaxRepositoryBytes: string | undefined;
  let originalMaxFileBytes: string | undefined;
  let originalMaxPushBytes: string | undefined;
  let lockApplicationName: string;
  let storageRoot: string;
  const cookie = (res: Response) => res.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const call = (method: string, path: string, cookies = '', body?: unknown, requestOrigin = origin) =>
    fetch(`${base}/${path}`, { method, headers: {
      'Content-Type': 'application/json', Origin: requestOrigin, ...(cookies ? { Cookie: cookies } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = (name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE', cookies = ownerCookie) =>
    call('POST', 'repositories', cookies, { name, visibility });

  beforeAll(async () => {
    await ConfigModule.forRoot({ envFilePath: '.env' });
    originalUrl = process.env.DATABASE_URL;
    originalUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
    originalQuota = process.env.MAX_REPOSITORIES_PER_USER;
    originalRetention = process.env.SOFT_DELETE_RETENTION_DAYS;
    originalStorage = process.env.GIT_STORAGE_PATH;
    originalMaxRepositoryBytes = process.env.MAX_REPOSITORY_BYTES;
    originalMaxFileBytes = process.env.MAX_FILE_BYTES;
    originalMaxPushBytes = process.env.MAX_PUSH_BYTES;
    if (!originalUrl) throw new Error('DATABASE_URL is required for integration tests');
    assertLoopbackTestDatabase(originalUrl, 'DATABASE_URL');
    if (originalUrlUnpooled) assertLoopbackTestDatabase(originalUrlUnpooled, 'DATABASE_URL_UNPOOLED');
    storageRoot = await mkdtemp(join(tmpdir(), 'code-forge-repositories-'));
    process.env.GIT_STORAGE_PATH = storageRoot;
    admin = new PrismaClient({ datasourceUrl: originalUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const url = new URL(originalUrl);
    url.searchParams.set('schema', schema);
    process.env.DATABASE_URL = url.toString();
    lockApplicationName = `repo-e2e-${schema.slice(-12)}`;
    const lockUrl = new URL(url.toString());
    lockUrl.searchParams.set('application_name', lockApplicationName);
    process.env.DATABASE_URL_UNPOOLED = lockUrl.toString();
    process.env.MAX_REPOSITORIES_PER_USER = '3';
    process.env.SOFT_DELETE_RETENTION_DAYS = '7';
    process.env.MAX_REPOSITORY_BYTES = String(32 * 1024);
    process.env.MAX_FILE_BYTES = String(1024);
    process.env.MAX_PUSH_BYTES = String(64 * 1024);
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      // Repository acceptance covers repository/API policy, not throttling;
      // auth.e2e-spec exercises the real rate-limit behavior separately.
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
    for (const username of ['Owner', 'Other']) {
      const res = await call('POST', 'auth/register', '', {
        username, email: `${username.toLowerCase()}@example.test`, password: 'test-password-123',
      });
      expect(res.status).toBe(201);
      if (username === 'Owner') {
        ownerCookie = cookie(res);
        ownerId = (await res.json()).user.id;
      } else otherCookie = cookie(res);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    if (admin) {
      try {
        if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.$disconnect();
      }
    }
    for (const [key, value] of Object.entries({
      DATABASE_URL: originalUrl, MAX_REPOSITORIES_PER_USER: originalQuota,
      DATABASE_URL_UNPOOLED: originalUrlUnpooled,
      SOFT_DELETE_RETENTION_DAYS: originalRetention,
      GIT_STORAGE_PATH: originalStorage,
      MAX_REPOSITORY_BYTES: originalMaxRepositoryBytes,
      MAX_FILE_BYTES: originalMaxFileBytes,
      MAX_PUSH_BYTES: originalMaxPushBytes,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('requires authentication and trusted origin; validates names, nulls and protected fields', async () => {
    expect((await call('POST', 'repositories', '', { name: 'Demo' })).status).toBe(401);
    expect((await call('POST', 'repositories', ownerCookie, { name: 'Demo' }, 'https://evil.example')).status).toBe(403);
    for (const body of [
      { name: '../escape' }, { name: 'repo.git' }, { name: 'a..b' }, { name: null },
      { name: 'x'.repeat(101) }, { name: 'Demo', visibility: null },
      { name: 'Demo', description: 'x'.repeat(2001) }, { name: 'Demo', ownerId },
      { name: 'Demo', storageKey: '/tmp/hijack.git' },
    ]) expect((await call('POST', 'repositories', ownerCookie, body)).status).toBe(400);
    expect(await db.repository.count()).toBe(0);
  });

  it('creates private metadata with a UUID storage key and hides private existence', async () => {
    const res = await call('POST', 'repositories', ownerCookie, { name: ' Demo ', description: 'Example', initializeReadme: true });
    expect(res.status).toBe(201);
    const { repository } = await res.json();
    expect(repository).toMatchObject({ name: 'Demo', visibility: 'PRIVATE', owner: { username: 'Owner' },
      permissions: { canRead: true, canWrite: true, canManage: true } });
    expect(repository.storageKey).toBeUndefined();
    expect(repository.owner.email).toBeUndefined();
    const stored = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    expect(stored.storageKey).toBe(`${repository.id}.git`);
    expect(await db.auditLog.count({ where: { targetId: repository.id, action: 'REPOSITORY_CREATED' } })).toBe(1);
    const bare = join(storageRoot, stored.storageKey);
    expect(execFileSync('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('refs/heads/main');
    expect(execFileSync('git', ['--git-dir', bare, 'show', 'HEAD:README.md'], { encoding: 'utf8' })).toBe('# Demo\n');
    expect(repository).toMatchObject({ storageState: 'READY', storageGeneration: 0, readme: '# Demo\n' });
    const branches = await (await call('GET', 'repos/owner/demo/branches', ownerCookie)).json();
    expect(branches.selectedBranch).toMatchObject({ name: 'main', isDefault: true });
    expect(branches.branches).toHaveLength(1);
    expect((await call('GET', 'repos/owner/demo/branches')).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/branches', otherCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/branches?ref=missing', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/branches?ref=..%2Fmain', ownerCookie)).status).toBe(400);
    expect((await call('GET', 'repos/owner/demo/branches?ref=a&ref=b', ownerCookie)).status).toBe(400);
    const treeResponse = await call('GET', 'repos/owner/demo/tree', ownerCookie);
    expect(treeResponse.status).toBe(200);
    expect(treeResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await treeResponse.json()).toMatchObject({ ref: 'main', path: '', entries: [{ name: 'README.md', type: 'file' }] });
    for (const cookies of ['', otherCookie]) {
      expect((await call('GET', 'repos/owner/demo/tree?path=..', cookies)).status).toBe(404);
    }
    for (const query of ['path=..%2Fsecret', 'path=%2Fetc%2Fpasswd', 'path=a&path=b', 'ref=a&ref=b']) {
      expect((await call('GET', `repos/owner/demo/tree?${query}`, ownerCookie)).status).toBe(400);
    }
    expect((await call('GET', 'repos/owner/demo/tree?ref=missing', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/tree?path=missing', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/tree?path=README.md', ownerCookie)).status).toBe(400);
    const blobResponse = await call('GET', 'repos/owner/demo/blob?path=README.md', ownerCookie);
    expect(blobResponse.status).toBe(200);
    expect(blobResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await blobResponse.json()).toMatchObject({ ref: 'main', path: 'README.md', kind: 'text', content: '# Demo\n', truncated: false });
    for (const cookies of ['', otherCookie]) {
      expect((await call('GET', 'repos/owner/demo/blob?path=README.md', cookies)).status).toBe(404);
      expect((await call('GET', 'repos/owner/demo/blob?path=..', cookies)).status).toBe(404);
    }
    for (const query of ['', 'path=', 'path=../secret', 'path=a&path=b', 'path=README.md&ref=a&ref=b']) {
      expect((await call('GET', `repos/owner/demo/blob?${query}`, ownerCookie)).status).toBe(400);
    }
    expect((await call('GET', 'repos/owner/demo/blob?path=missing', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/blob?path=README.md&ref=missing', ownerCookie)).status).toBe(404);
    const gitImage = (args: string[], input?: string | Buffer) => execFileSync('git', ['--git-dir', bare, ...args], { encoding: 'utf8', input }).trim();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64');
    const imageBlob = gitImage(['hash-object', '-w', '--stdin'], png);
    const readmeBlob = gitImage(['hash-object', '-w', '--stdin'], '# Feature README\n![logo](logo.png)');
    const imageTree = gitImage(['mktree'], `100644 blob ${imageBlob}\tlogo.png\n100644 blob ${readmeBlob}\tREADME.md\n`);
    const imageCommit = gitImage(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', imageTree, '-m', 'Feature']);
    gitImage(['update-ref', 'refs/heads/feature/readme', imageCommit]);
    const history = await call('GET', 'repos/owner/demo/commits?ref=feature%2Freadme', ownerCookie);
    expect(history.status).toBe(200);
    expect(history.headers.get('cache-control')).toBe('private, no-store');
    expect(await history.json()).toMatchObject({ ref: 'feature/readme', page: 1, snapshot: imageCommit, hasMore: false, commits: [{ sha: imageCommit, subject: 'Feature' }] });
    const detail = await call('GET', `repos/owner/demo/commits/${imageCommit}`, ownerCookie);
    expect(detail.status).toBe(200);
    expect(detail.headers.get('cache-control')).toBe('private, no-store');
    expect(await detail.json()).toMatchObject({ commit: { sha: imageCommit, parentShas: [], author: { name: 'Test' } } });
    for (const cookies of ['', otherCookie]) {
      for (const suffix of ['commits?page=bad', `commits/${imageCommit}`, 'commits/invalid']) expect((await call('GET', `repos/owner/demo/${suffix}`, cookies)).status).toBe(404);
    }
    for (const query of ['page=0', 'page=1001', 'page=1&page=2', 'ref=a&ref=b', 'snapshot=HEAD', `snapshot=${imageCommit}&snapshot=${imageCommit}`]) expect((await call('GET', `repos/owner/demo/commits?${query}`, ownerCookie)).status).toBe(400);
    expect((await call('GET', 'repos/owner/demo/commits/invalid', ownerCookie)).status).toBe(400);
    expect((await call('GET', `repos/owner/demo/commits/${imageBlob}`, ownerCookie)).status).toBe(404);
    expect((await call('GET', `repos/owner/demo/commits/${'f'.repeat(40)}`, ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/commits?ref=missing', ownerCookie)).status).toBe(404);
    expect((await call('GET', `repos/owner/demo/commits?ref=main&snapshot=${imageCommit}`, ownerCookie)).status).toBe(404);
    expect(await (await call('GET', 'repos/owner/demo/blob?ref=feature%2Freadme&path=README.md', ownerCookie)).json()).toMatchObject({ content: '# Feature README\n![logo](logo.png)', ref: 'feature/readme' });
    const imageResponse = await call('GET', 'repos/owner/demo/image?ref=feature%2Freadme&path=logo.png', ownerCookie);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await imageResponse.json()).toMatchObject({ kind: 'image', mime: 'image/png', content: png.toString('base64') });
    for (const cookies of ['', otherCookie]) expect((await call('GET', 'repos/owner/demo/image?ref=feature%2Freadme&path=logo.png', cookies)).status).toBe(404);
    for (const query of ['path=..', 'path=a&path=b', 'path=logo.png&ref=a&ref=b', '']) expect((await call('GET', `repos/owner/demo/image?${query}`, ownerCookie)).status).toBe(400);
    expect((await call('GET', 'repos/owner/demo/image?path=logo.png', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/image?path=README.md', ownerCookie)).status).toBe(400);
    await rm(bare, { recursive: true });
    const concurrentRecoveryResponses = await Promise.all(Array.from({ length: 5 }, () =>
      call('GET', 'repos/owner/demo/commits', ownerCookie)));
    expect(concurrentRecoveryResponses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const concurrentRecoveryResults = await Promise.all(concurrentRecoveryResponses.map(async (response) =>
      await response.json() as { commits: unknown[]; storageState: string; storageGeneration: number }));
    for (const recovery of concurrentRecoveryResults) {
      expect(recovery).toMatchObject({ commits: [], storageState: 'RESET', storageGeneration: 1 });
    }
    expect((await db.repository.findUniqueOrThrow({ where: { id: stored.id } })).storageGeneration).toBe(1);
    expect((await call('GET', `repos/owner/demo/commits/${imageCommit}`, ownerCookie)).status).toBe(404);
    expect(await (await call('GET', 'repos/owner/demo/commits', ownerCookie)).json()).toMatchObject({ commits: [], storageState: 'RESET', storageGeneration: 1 });
    expect((await call('GET', `repos/owner/demo/commits?snapshot=${imageCommit}`, ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/blob?path=README.md&ref=main', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/tree?ref=main', ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo/branches?ref=main', ownerCookie)).status).toBe(404);
    const recovered = await (await call('GET', 'repos/owner/demo', ownerCookie)).json();
    expect(recovered.repository).toMatchObject({ storageState: 'RESET', storageGeneration: 1, readme: null });
    expect(await (await call('GET', 'repos/owner/demo/branches', ownerCookie)).json()).toMatchObject({ storageState: 'RESET', branches: [], selectedBranch: null });
    expect(await (await call('GET', 'repos/owner/demo/tree', ownerCookie)).json()).toMatchObject({ storageState: 'RESET', storageGeneration: 1, entries: [], commitSha: null });
    expect(execFileSync('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('refs/heads/main');
    expect((await (await call('GET', 'repos/owner/demo', ownerCookie)).json()).repository.storageGeneration).toBe(1);
    expect((await call('GET', 'repos/OWNER/DEMO', ownerCookie)).status).toBe(200);
    const hidden = await call('GET', 'repos/owner/demo', otherCookie);
    expect(hidden.status).toBe(404);
    const hiddenBody = await hidden.json();
    const missingBody = await (await call('GET', 'repos/owner/missing', otherCookie)).json();
    expect(hiddenBody.error).toEqual(missingBody.error);
    expect((await call('GET', 'repos/owner/demo')).status).toBe(404);
    expect((await call('PATCH', 'repos/owner/demo', otherCookie, { name: 'Stolen' })).status).toBe(404);
    expect((await call('DELETE', 'repos/owner/demo', otherCookie)).status).toBe(404);
    expect((await create('DEMO')).status).toBe(409);
    expect((await create('Demo', 'PRIVATE', otherCookie)).status).toBe(201);
  }, 30_000);

  it('allows anonymous public reads but rejects non-owner mutations and invalid tokens', async () => {
    expect((await create('Public', 'PUBLIC')).status).toBe(201);
    expect(await (await call('GET', 'repos/owner/public/commits')).json()).toMatchObject({ commits: [], storageState: 'EMPTY', snapshot: null });
    expect(await (await call('GET', 'repos/owner/public/branches')).json()).toMatchObject({ branches: [], selectedBranch: null, storageState: 'EMPTY' });
    expect(await (await call('GET', 'repos/owner/public/tree')).json()).toMatchObject({ entries: [], ref: null, storageState: 'EMPTY' });
    expect((await call('GET', 'repos/owner/public/blob?path=README.md')).status).toBe(404);
    const publicRepo = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'public' } });
    const git = (args: string[], input?: string) => execFileSync('git', ['--git-dir', join(storageRoot, publicRepo.storageKey), ...args], { encoding: 'utf8', input }).trim();
    const blob = git(['hash-object', '-w', '--stdin'], 'public source');
    const tree = git(['mktree'], `100644 blob ${blob}\tcode.txt\n`);
    const commit = git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', tree, '-m', 'Public']);
    git(['update-ref', 'refs/heads/main', commit]);
    expect(await (await call('GET', 'repos/owner/public/commits')).json()).toMatchObject({ commits: [{ sha: commit }], ref: 'main' });
    expect(await (await call('GET', `repos/owner/public/commits/${commit}`)).json()).toMatchObject({ commit: { sha: commit, subject: 'Public' } });
    expect(await (await call('GET', 'repos/owner/public/blob?path=code.txt')).json()).toMatchObject({ kind: 'text', content: 'public source' });
    const publicList = await (await call('GET', 'repositories')).json();
    expect(publicList.repositories.map((repo: { name: string }) => repo.name)).toEqual(['Public']);
    expect(publicList.repositories[0].permissions).toEqual({ canRead: true, canWrite: false, canManage: false });
    expect((await (await call('GET', 'repositories?q=owner')).json()).repositories).toHaveLength(1);
    expect((await (await call('GET', 'repositories?q=missing')).json()).repositories).toHaveLength(0);
    expect((await call('GET', 'repositories?page=0')).status).toBe(400);
    const anonymousProfile = await (await call('GET', 'users/Owner')).json();
    expect(anonymousProfile.repositories.map((repo: { name: string }) => repo.name)).toEqual(['Public']);
    expect((await (await call('GET', 'repositories/owner/Owner', ownerCookie)).json()).repositories.map((repo: { name: string }) => repo.name).sort()).toEqual(['Demo', 'Public']);
    expect((await (await call('GET', 'repositories/owner/Owner', otherCookie)).json()).repositories.map((repo: { name: string }) => repo.name)).toEqual(['Public']);
    expect((await (await call('GET', 'repositories/owner/Owner')).json()).repositories.map((repo: { name: string }) => repo.name)).toEqual(['Public']);
    const publicRes = await call('GET', 'repos/owner/public');
    expect(publicRes.status).toBe(200);
    expect((await publicRes.json()).repository.permissions).toEqual({ canRead: true, canWrite: false, canManage: false });
    expect((await call('PATCH', 'repos/owner/public', otherCookie, { description: 'Hijack' })).status).toBe(403);
    expect((await call('DELETE', 'repos/owner/public', otherCookie)).status).toBe(403);
    expect((await call('PATCH', 'repos/owner/public', '', { name: 'Hijack' })).status).toBe(401);
    expect((await call('GET', 'repos/owner/public', 'code_forge_access=invalid')).status).toBe(401);
    expect((await call('DELETE', 'repos/owner/public', ownerCookie, undefined, 'https://evil.example')).status).toBe(403);
    expect((await call('PATCH', 'repos/owner/public', ownerCookie, { visibility: 'PRIVATE' }, 'https://evil.example')).status).toBe(403);
  });

  it('M3.6 clones/fetches public Git with v0/v2, hides private/deleted/locked and recovers missing storage', async () => {
    const run = promisify(execFile);
    const git = (args: string[]) => run('git', args, { timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    const url = `${base}/git/Owner/Public.git`;
    const pub = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'public' } });
    const bare = join(storageRoot, pub.storageKey);
    const work = join(storageRoot, 'http-clone');
    const advertisement = await fetch(`${url}/info/refs?service=git-upload-pack`);
    expect(advertisement.status).toBe(200);
    expect(advertisement.headers.get('content-type')).toBe('application/x-git-upload-pack-advertisement');
    expect(advertisement.headers.get('cache-control')).toBe('private, no-store');
    expect(await advertisement.text()).toContain('# service=git-upload-pack');
    await git(['-c', 'protocol.version=2', 'clone', url, work]);
    expect(await readFile(join(work, 'code.txt'), 'utf8')).toBe('public source');
    const first = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    const tree = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const next = execFileSync('git', ['--git-dir', bare, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', tree, '-p', first, '-m', 'Fetched commit'], { encoding: 'utf8' }).trim();
    await git(['--git-dir', bare, 'update-ref', 'refs/heads/main', next]);
    await git(['--git-dir', bare, 'update-ref', 'refs/heads/feature/test', first]);
    await git(['-C', work, '-c', 'protocol.version=0', 'fetch', 'origin']);
    expect((await git(['-C', work, 'rev-parse', 'origin/main'])).stdout.trim()).toBe(next);
    expect((await git(['-C', work, 'rev-parse', 'origin/feature/test'])).stdout.trim()).toBe(first);
    await git(['-C', work, 'pull', '--ff-only']);
    expect((await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(next);
    await git(['-c', 'protocol.version=0', 'clone', '--depth=1', url, join(storageRoot, 'shallow-clone')]);
    expect((await git(['-C', join(storageRoot, 'shallow-clone'), 'rev-list', '--count', 'HEAD'])).stdout.trim()).toBe('1');
    for (const name of ['Demo', 'Missing']) {
      for (const cookie of ['', ownerCookie, otherCookie]) {
        const hidden = `${base}/git/Owner/${name}.git`;
        expect((await fetch(`${hidden}/info/refs?service=git-upload-pack`, { headers: { Cookie: cookie } })).status).toBe(401);
        expect((await fetch(`${hidden}/git-upload-pack`, { method: 'POST' })).status).toBe(401);
      }
    }
    for (const query of ['', '?service=git-upload-pack&service=git-upload-pack']) expect((await fetch(`${url}/info/refs${query}`)).status).toBe(400);
    expect((await fetch(`${url}/info/refs?service=git-receive-pack`)).status).toBe(401);
    expect((await fetch(`${url}/git-receive-pack`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${url}/HEAD`)).status).toBe(404);
    expect((await fetch(`${url}/objects/info/packs`)).status).toBe(404);
    expect((await fetch(`${base}/git/Owner/%2e%2e%2fPublic.git/info/refs?service=git-upload-pack`)).status).toBe(404);
    expect((await fetch(`${url}/git-upload-pack`, { method: 'POST', body: '0000' })).status).toBe(415);
    const gzip = await fetch(`${url}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request', 'content-encoding': 'gzip' }, body: gzipSync('0000') });
    expect(gzip.status).toBe(200);
    expect(gzip.headers.get('content-type')).toBe('application/x-git-upload-pack-result');
    await gzip.arrayBuffer();
    expect((await fetch(`${url}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request' }, body: 'x'.repeat(1048577) })).status).toBe(413);
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/forbidden'])).rejects.toThrow();
    for (const change of [{ visibility: 'PRIVATE' as const }, { status: 'DELETED' as const }, { status: 'LOCKED' as const }]) {
      await db.repository.update({ where: { id: pub.id }, data: change });
      expect((await fetch(`${url}/info/refs?service=git-upload-pack`)).status).toBe(401);
      expect((await fetch(`${url}/git-upload-pack`, { method: 'POST' })).status).toBe(401);
      await db.repository.update({ where: { id: pub.id }, data: { visibility: 'PUBLIC', status: 'ACTIVE' } });
    }
    await rm(bare, { recursive: true });
    await git(['clone', url, join(storageRoot, 'empty-clone')]);
    expect((await git(['-C', join(storageRoot, 'empty-clone'), 'symbolic-ref', 'HEAD'])).stdout.trim()).toBe('refs/heads/main');
    expect((await db.repository.findUniqueOrThrow({ where: { id: pub.id } })).storageGeneration).toBe(1);
  }, 60_000);

  it('M3.7 manages PATs and enforces private Git READ/WRITE/OWNER, expiry, revocation and identity', async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const input = { name: 'CLI test', scopes: ['repo:read'], expiresAt };
    expect((await call('GET', 'tokens')).status).toBe(401);
    expect((await call('POST', 'tokens', ownerCookie, input, 'https://evil.example')).status).toBe(403);
    for (const body of [{ ...input, scopes: [] }, { ...input, scopes: ['admin'] }, { ...input, expiresAt: '2000-01-01' }, { ...input, expiresAt: new Date(Date.now() + 366 * 86400000).toISOString() }, { ...input, name: ' ' }]) {
      expect((await call('POST', 'tokens', ownerCookie, body)).status).toBe(400);
    }
    const response = await call('POST', 'tokens', ownerCookie, input);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const ownerToken = await response.json();
    expect(ownerToken.secret).toMatch(/^cfg_[a-f0-9]{16}_[a-f0-9]{64}$/);
    const otherToken = await (await call('POST', 'tokens', otherCookie, input)).json();
    const other = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'other' } });
    const stored = await db.personalAccessToken.findUniqueOrThrow({ where: { id: ownerToken.token.id } });
    expect(stored.tokenHash).not.toBe(ownerToken.secret);
    expect(JSON.stringify(stored)).not.toContain(ownerToken.secret);
    const list = await call('GET', 'tokens', ownerCookie);
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    const listed = await list.text();
    expect(listed).not.toContain(ownerToken.secret);
    expect(listed).not.toContain('tokenHash');
    expect(listed).not.toContain(otherToken.token.id);
    expect((await call('DELETE', `tokens/${ownerToken.token.id}`, otherCookie)).status).toBe(404);
    const basic = (username: string, secret: string) => `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;
    const ownerAuth = basic('Owner', ownerToken.secret);
    const otherAuth = basic('Other', otherToken.secret);
    const url = `${base}/git/Owner/Demo.git`;
    const request = (auth?: string, name = 'Demo', rpc = false) => fetch(`${base}/git/Owner/${name}.git/${rpc ? 'git-upload-pack' : 'info/refs?service=git-upload-pack'}`, {
      method: rpc ? 'POST' : 'GET', headers: { ...(auth === undefined ? {} : { Authorization: auth }), 'content-type': 'application/x-git-upload-pack-request' }, ...(rpc ? { body: '0000' } : {}),
    });
    for (const name of ['Demo', 'Missing']) {
      const hidden = await request(undefined, name);
      expect(hidden.status).toBe(401);
      expect(hidden.headers.get('www-authenticate')).toBe('Basic realm="Code Forge Git", charset="UTF-8"');
      expect(await hidden.text()).toBe('Git request unavailable.\n');
      expect((await request(otherAuth, name)).status).toBe(404);
    }
    for (const auth of [basic('Other', ownerToken.secret), basic('Owner', 'test-password-123'), 'Bearer invalid', 'Basic !!!', basic('Owner', ownerToken.secret.slice(0, -1) + (ownerToken.secret.endsWith('0') ? '1' : '0'))]) {
      expect((await request(auth)).status).toBe(401);
      expect((await request(auth, 'Missing')).status).toBe(401);
    }
    const repo = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'demo' } });
    const bare = join(storageRoot, repo.storageKey);
    execFileSync('git', ['--git-dir', bare, 'update-ref', '-d', 'refs/heads/main']);
    const localGit = (args: string[], input?: string) => execFileSync('git', ['--git-dir', bare, ...args], { input, encoding: 'utf8' }).trim();
    const blob = localGit(['hash-object', '-w', '--stdin'], 'private source\n');
    const tree = localGit(['mktree'], `100644 blob ${blob}\tprivate.txt\n`);
    const commit = localGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', tree, '-m', 'Private']);
    localGit(['update-ref', 'refs/heads/main', commit]);
    // Git obtains username/PAT only after the HTTP challenge, not in URL or argv.
    const askpass = join(storageRoot, 'askpass.sh');
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n', { mode: 0o700 });
    const run = promisify(execFile);
    const cli = (args: string[], username = 'Owner', secret = ownerToken.secret) => run('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: username, TEST_GIT_PAT: secret },
    });
    const ownerWork = join(storageRoot, 'private-owner');
    await cli(['-c', 'protocol.version=2', 'clone', url, ownerWork]);
    expect(await readFile(join(ownerWork, 'private.txt'), 'utf8')).toBe('private source\n');
    await db.user.update({ where: { id: other.id }, data: { systemRole: 'ADMIN' } });
    expect((await request(otherAuth)).status).toBe(404);
    for (const role of ['READ', 'WRITE'] as const) {
      await db.repositoryMember.upsert({ where: { repositoryId_userId: { repositoryId: repo.id, userId: other.id } }, create: { repositoryId: repo.id, userId: other.id, role }, update: { role } });
      const work = join(storageRoot, `private-${role}`);
      await cli(['clone', url, work], 'Other', otherToken.secret);
      await cli(['-C', work, '-c', 'protocol.version=0', 'fetch', 'origin'], 'Other', otherToken.secret);
      expect(await readFile(join(work, 'private.txt'), 'utf8')).toBe('private source\n');
      const metadata = await call('GET', 'repos/owner/demo', otherCookie);
      expect(metadata.status).toBe(200);
      expect((await metadata.json()).repository.permissions).toEqual({ canRead: true, canWrite: role === 'WRITE', canManage: false });
      expect((await call('GET', 'repos/owner/demo/blob?path=private.txt', otherCookie)).status).toBe(200);
      expect((await call('PATCH', 'repos/owner/demo', otherCookie, { description: 'No' })).status).not.toBe(200);
      expect((await fetch(`${url}/git-receive-pack`, { method: 'POST', headers: { Authorization: otherAuth } })).status).toBe(401);
    }
    await db.repositoryMember.delete({ where: { repositoryId_userId: { repositoryId: repo.id, userId: other.id } } });
    expect((await request(otherAuth)).status).toBe(404);
    expect((await request(otherAuth, 'Demo', true)).status).toBe(404);
    expect((await call('GET', 'repos/owner/demo', otherCookie)).status).toBe(404);
    await db.user.update({ where: { id: other.id }, data: { systemRole: 'USER' } });
    for (const change of [{ scopes: ['repo:write'] }, { expiresAt: new Date(Date.now() - 1000) }, { revokedAt: new Date() }]) {
      await db.personalAccessToken.update({ where: { id: ownerToken.token.id }, data: change });
      expect((await request(ownerAuth)).status).toBe(401);
      expect((await request(ownerAuth, 'Demo', true)).status).toBe(401);
      await db.personalAccessToken.update({ where: { id: ownerToken.token.id }, data: { scopes: ['repo:read'], expiresAt, revokedAt: null } });
    }
    await db.user.update({ where: { id: ownerId }, data: { status: 'LOCKED' } });
    expect((await request(ownerAuth)).status).toBe(401);
    expect((await call('GET', 'tokens', ownerCookie)).status).toBe(401);
    await db.user.update({ where: { id: ownerId }, data: { status: 'ACTIVE' } });
    for (const status of ['LOCKED', 'DELETED'] as const) {
      await db.repository.update({ where: { id: repo.id }, data: { status } });
      expect((await request(ownerAuth)).status).toBe(404);
      expect((await request(ownerAuth, 'Demo', true)).status).toBe(404);
    }
    await db.repository.update({ where: { id: repo.id }, data: { status: 'ACTIVE' } });
    await rm(bare, { recursive: true });
    await cli(['clone', url, join(storageRoot, 'private-reset')]);
    expect((await db.repository.findUniqueOrThrow({ where: { id: repo.id } })).storageGeneration).toBe(2);
    expect((await db.personalAccessToken.findUniqueOrThrow({ where: { id: ownerToken.token.id } })).lastUsedAt).not.toBeNull();
    expect((await call('DELETE', `tokens/${ownerToken.token.id}`, ownerCookie, undefined, 'https://evil.example')).status).toBe(403);
    expect((await call('DELETE', `tokens/${ownerToken.token.id}`, ownerCookie)).status).toBe(204);
    expect((await call('DELETE', `tokens/${ownerToken.token.id}`, ownerCookie)).status).toBe(204);
    await expect(cli(['-C', ownerWork, 'fetch', 'origin'])).rejects.toThrow();
    expect(await db.auditLog.count({ where: { targetId: ownerToken.token.id, action: 'TOKEN_CREATED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: ownerToken.token.id, action: 'TOKEN_REVOKED' } })).toBe(1);
  }, 60_000);

  it('M4 pushes with WRITE/OWNER, protects refs and rejects quota violations without moving refs', async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const makeToken = async (userId: string, name: string, scopes: string[]) => {
      const tokenPrefix = randomBytes(8).toString('hex');
      const secret = `cfg_${tokenPrefix}_${randomBytes(32).toString('hex')}`;
      const token = await db.personalAccessToken.create({ data: {
        userId, name, scopes, expiresAt, tokenPrefix,
        tokenHash: createHash('sha256').update(secret).digest('hex'),
      } });
      return { token, secret };
    };
    const other = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'other' } });
    const ownerToken = await makeToken(ownerId, 'M4 owner', ['repo:read', 'repo:write']);
    const readToken = await makeToken(ownerId, 'M4 read only', ['repo:read']);
    const writeOnlyToken = await makeToken(other.id, 'M4 write only', ['repo:write']);
    const repo = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'demo' } });
    const bare = join(storageRoot, repo.storageKey);
    // The exact 255-byte ref path can exceed MAX_PATH under the Windows temp root.
    execFileSync('git', ['--git-dir', bare, 'config', 'core.longpaths', 'true']);
    const url = `${base}/git/Owner/Demo.git`;
    const askpass = join(storageRoot, 'm4-askpass.sh');
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n', { mode: 0o700 });
    const run = promisify(execFile);
    const git = (args: string[], username = 'Owner', secret = ownerToken.secret) => run('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: askpass, TEST_GIT_USER: username, TEST_GIT_PAT: secret },
    });
    const basic = (username: string, secret: string) => `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;
    const work = join(storageRoot, 'm4-owner');
    await git(['init', '--initial-branch=main', work]);
    await git(['-C', work, 'config', 'user.name', 'M4 Tester']);
    await git(['-C', work, 'config', 'user.email', 'm4@example.test']);
    await git(['-C', work, 'remote', 'add', 'origin', url]);
    await writeFile(join(work, 'code.txt'), 'first\n');
    await git(['-C', work, 'add', 'code.txt']);
    await git(['-C', work, 'commit', '-m', 'First push']);
    const first = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', work, 'push', '-u', 'origin', 'main']);
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(first);

    const concurrentPushes: { directory: string; branch: string; file: string; content: string; sha: string }[] = [
      { directory: join(storageRoot, 'm4-push-race-a'), branch: 'parallel/race-a', file: 'parallel-a.txt', content: 'push A\n', sha: '' },
      { directory: join(storageRoot, 'm4-push-race-b'), branch: 'parallel/race-b', file: 'parallel-b.txt', content: 'push B\n', sha: '' },
    ];
    for (const candidate of concurrentPushes) {
      await git(['clone', url, candidate.directory]);
      await git(['-C', candidate.directory, 'config', 'user.name', 'M4 Race Tester']);
      await git(['-C', candidate.directory, 'config', 'user.email', 'm4-race@example.test']);
      await writeFile(join(candidate.directory, candidate.file), candidate.content);
      await git(['-C', candidate.directory, 'add', candidate.file]);
      await git(['-C', candidate.directory, 'commit', '-m', `Concurrent push ${candidate.branch}`]);
      candidate.sha = (await git(['-C', candidate.directory, 'rev-parse', 'HEAD'])).stdout.trim();
    }
    await Promise.all(concurrentPushes.map((candidate) =>
      git(['-C', candidate.directory, 'push', 'origin', `HEAD:refs/heads/${candidate.branch}`]),
    ));
    for (const candidate of concurrentPushes) {
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${candidate.branch}`], { encoding: 'utf8' }).trim()).toBe(candidate.sha);
    }
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(first);

    const sameRefBranch = 'parallel/same-ref';
    await git(['-C', work, 'push', 'origin', `${first}:refs/heads/${sameRefBranch}`]);
    const sameRefPushes = [
      { directory: join(storageRoot, 'm4-same-ref-race-a'), file: 'same-ref-a.txt', content: 'same-ref A\n', sha: '' },
      { directory: join(storageRoot, 'm4-same-ref-race-b'), file: 'same-ref-b.txt', content: 'same-ref B\n', sha: '' },
    ];
    for (const candidate of sameRefPushes) {
      await git(['clone', url, candidate.directory]);
      await git(['-C', candidate.directory, 'checkout', '-b', sameRefBranch, `origin/${sameRefBranch}`]);
      await git(['-C', candidate.directory, 'config', 'user.name', 'M4 Same-Ref Tester']);
      await git(['-C', candidate.directory, 'config', 'user.email', 'm4-same-ref@example.test']);
      await writeFile(join(candidate.directory, candidate.file), candidate.content);
      await git(['-C', candidate.directory, 'add', candidate.file]);
      await git(['-C', candidate.directory, 'commit', '-m', `Same-ref push ${candidate.file}`]);
      candidate.sha = (await git(['-C', candidate.directory, 'rev-parse', 'HEAD'])).stdout.trim();
    }
    const operationsBeforeSameRefRace = new Set((await db.gitPushOperation.findMany({
      where: { repositoryId: repo.id }, select: { operationId: true },
    })).map(({ operationId }) => operationId));
    const auditBeforeSameRefRace = new Set((await db.auditLog.findMany({
      where: { targetId: repo.id, action: 'GIT_PUSH_COMPLETED' }, select: { id: true },
    })).map(({ id }) => id));
    const barrier = new Client({ connectionString: originalUrl });
    let barrierHeld = false;
    let sameRefPushesPromise: Promise<PromiseSettledResult<unknown>[]> | undefined;
    let sameRefResults: PromiseSettledResult<unknown>[] = [];
    const unlockBarrier = async () => {
      if (!barrierHeld) return;
      const result = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repo.id]);
      if (!result.rows[0]?.pg_advisory_unlock) throw new Error('The same-ref race barrier lock was not held.');
      barrierHeld = false;
    };
    try {
      await barrier.connect();
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [repo.id]);
      barrierHeld = true;
      sameRefPushesPromise = Promise.allSettled(sameRefPushes.map((candidate) =>
        git(['-C', candidate.directory, 'push', 'origin', `HEAD:refs/heads/${sameRefBranch}`]),
      ));

      const deadline = Date.now() + 5_000;
      let waitingForSameRepoLock = 0;
      do {
        const waiters = await admin.$queryRawUnsafe<{ waiting: number }[]>(`
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
            AND pg_lock.objsubid = 1`, lockApplicationName, repo.id);
        waitingForSameRepoLock = waiters[0]?.waiting ?? 0;
        if (waitingForSameRepoLock === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      expect(waitingForSameRepoLock).toBe(2);
      await unlockBarrier();
      sameRefResults = await sameRefPushesPromise;
    } finally {
      try {
        await unlockBarrier();
      } finally {
        if (sameRefPushesPromise) sameRefResults = await sameRefPushesPromise;
        await barrier.end();
      }
    }
    expect(sameRefResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(sameRefResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const sameRef = execFileSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${sameRefBranch}`], { encoding: 'utf8' }).trim();
    expect(sameRefPushes.map(({ sha }) => sha)).toContain(sameRef);
    expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' }).trim().split(/\r?\n/).sort())
      .toEqual(['refs/heads/main', 'refs/heads/parallel/race-a', 'refs/heads/parallel/race-b', `refs/heads/${sameRefBranch}`].sort());
    for (const branch of ['main', 'parallel/race-a', 'parallel/race-b']) {
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8' }).trim())
        .toBe(branch === 'main' ? first : concurrentPushes.find(({ branch: candidateBranch }) => candidateBranch === branch)!.sha);
    }
    expect(() => execFileSync('git', ['--git-dir', bare, 'fsck', '--connectivity-only'], { stdio: 'pipe' })).not.toThrow();

    const sameRefOperations = (await db.gitPushOperation.findMany({ where: { repositoryId: repo.id } }))
      .filter(({ operationId }) => !operationsBeforeSameRefRace.has(operationId));
    expect(sameRefOperations).toHaveLength(2);
    const completedOperation = sameRefOperations.find(({ status }) => status === 'COMPLETED');
    const rejectedOperation = sameRefOperations.find(({ status }) => status === 'FAILED');
    expect(completedOperation).toMatchObject({ changedRefCount: 1, errorCode: null });
    expect(rejectedOperation).toMatchObject({ changedRefCount: null, errorCode: 'NO_REF_CHANGE' });
    const sameRefAudit = (await db.auditLog.findMany({
      where: { targetId: repo.id, action: 'GIT_PUSH_COMPLETED' },
    })).filter(({ id }) => !auditBeforeSameRefRace.has(id));
    expect(sameRefAudit).toHaveLength(1);
    expect(sameRefAudit[0]?.details).toMatchObject({ operationId: completedOperation?.operationId, changedRefCount: 1 });
    expect(sameRefAudit[0]?.details).not.toMatchObject({ operationId: rejectedOperation?.operationId });

    const byteLimitBranch = `${'é'.repeat(63)}a/${'é'.repeat(63)}a`;
    const overByteLimitBranch = `${'é'.repeat(64)}/${'é'.repeat(63)}a`;
    expect(Buffer.byteLength(byteLimitBranch, 'utf8')).toBe(255);
    expect(Buffer.byteLength(overByteLimitBranch, 'utf8')).toBe(256);
    await git(['-C', work, 'push', 'origin', `HEAD:refs/heads/${byteLimitBranch}`]);
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${byteLimitBranch}`], { encoding: 'utf8' }).trim()).toBe(first);
    await expect(git(['-C', work, 'push', 'origin', `HEAD:refs/heads/${overByteLimitBranch}`])).rejects.toThrow();
    expect(() => execFileSync('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${overByteLimitBranch}`], { stdio: 'pipe' })).toThrow();
    expect(await db.gitPushOperation.count({ where: { repositoryId: repo.id,
      status: { in: ['PENDING', 'NEEDS_RECONCILIATION'] } } })).toBe(0);

    await writeFile(join(work, 'code.txt'), 'second\n');
    await git(['-C', work, 'add', 'code.txt']);
    await git(['-C', work, 'commit', '-m', 'Feature change']);
    const second = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    await expect(git(['-C', work, 'push', 'origin', 'main'])).rejects.toThrow();
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(first);

    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/read-token-denied'], 'Owner', readToken.secret)).rejects.toThrow();
    await db.repositoryMember.upsert({
      where: { repositoryId_userId: { repositoryId: repo.id, userId: other.id } },
      create: { repositoryId: repo.id, userId: other.id, role: 'READ' }, update: { role: 'READ' },
    });
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/member-denied'], 'Other', writeOnlyToken.secret)).rejects.toThrow();
    await db.repositoryMember.update({ where: { repositoryId_userId: { repositoryId: repo.id, userId: other.id } }, data: { role: 'WRITE' } });
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/main'], 'Other', writeOnlyToken.secret)).rejects.toThrow();
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(first);
    await git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/member-write'], 'Other', writeOnlyToken.secret);
    expect((await fetch(`${url}/info/refs?service=git-upload-pack`, { headers: { Authorization: basic('Other', writeOnlyToken.secret) } })).status).toBe(401);

    // Exercise a real non-fast-forward update while the remote feature ref still exists.
    await git(['-C', work, 'reset', '--hard', first]);
    await writeFile(join(work, 'code.txt'), 'divergent\n');
    await git(['-C', work, 'add', 'code.txt']);
    await git(['-C', work, 'commit', '-m', 'Divergent']);
    await expect(git(['-C', work, 'push', '--force', 'origin', 'HEAD:refs/heads/member-write'])).rejects.toThrow();
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/member-write'], { encoding: 'utf8' }).trim()).toBe(second);
    await git(['-C', work, 'reset', '--hard', second]);

    const branchDeleteSha = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/member-write'], { encoding: 'utf8' }).trim();
    const pushOperationsBeforeDelete = new Set((await db.gitPushOperation.findMany({
      where: { repositoryId: repo.id }, select: { operationId: true },
    })).map(({ operationId }) => operationId));
    const pushAuditsBeforeDelete = new Set((await db.auditLog.findMany({
      where: { targetId: repo.id, action: 'GIT_PUSH_COMPLETED' }, select: { id: true },
    })).map(({ id }) => id));
    await git(['-C', work, 'push', 'origin', '--delete', 'member-write'], 'Other', writeOnlyToken.secret);
    expect(() => execFileSync('git', ['--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/member-write'], { stdio: 'pipe' })).toThrow();
    const deletionOperations = (await db.gitPushOperation.findMany({ where: { repositoryId: repo.id } }))
      .filter(({ operationId }) => !pushOperationsBeforeDelete.has(operationId));
    expect(deletionOperations).toHaveLength(1);
    expect(deletionOperations[0]).toMatchObject({ status: 'COMPLETED', changedRefCount: 1, errorCode: null, beforeRefs: null });
    const deletionAudits = (await db.auditLog.findMany({ where: { targetId: repo.id, action: 'GIT_PUSH_COMPLETED' } }))
      .filter(({ id }) => !pushAuditsBeforeDelete.has(id));
    expect(deletionAudits).toHaveLength(1);
    expect(deletionAudits[0]?.details).toMatchObject({ operationId: deletionOperations[0]?.operationId,
      repositoryId: repo.id, changedRefCount: 1 });
    const deletionRecord = JSON.stringify({ operation: deletionOperations[0], audit: deletionAudits[0]?.details });
    expect(deletionRecord).not.toContain('member-write');
    expect(deletionRecord).not.toContain(branchDeleteSha);
    await db.repositoryMember.delete({ where: { repositoryId_userId: { repositoryId: repo.id, userId: other.id } } });
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/member-revoked'], 'Other', writeOnlyToken.secret)).rejects.toThrow();

    await expect(git(['-C', work, 'push', 'origin', ':main'])).rejects.toThrow();
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/tags/not-allowed'])).rejects.toThrow();

    await writeFile(join(work, 'too-large.bin'), randomBytes(1025));
    await git(['-C', work, 'add', 'too-large.bin']);
    await git(['-C', work, 'commit', '-m', 'Oversized file']);
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/feature/oversized'])).rejects.toThrow();
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(first);
    await git(['-C', work, 'reset', '--hard', second]);

    for (let index = 0; index < 40; index++) await writeFile(join(work, `quota-${index}.bin`), randomBytes(900));
    await git(['-C', work, 'add', '.']);
    await git(['-C', work, 'commit', '-m', 'Repository quota']);
    await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/feature/quota'])).rejects.toThrow();
    expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(first);

    const oversizedRequest = await fetch(`${url}/git-receive-pack`, {
      method: 'POST', headers: { Authorization: basic('Owner', ownerToken.secret), 'content-type': 'application/x-git-receive-pack-request' },
      body: Buffer.alloc(64 * 1024 + 1),
    });
    expect(oversizedRequest.status).toBe(413);
    await call('DELETE', `tokens/${ownerToken.token.id}`, ownerCookie);
    const revoked = await fetch(`${url}/info/refs?service=git-receive-pack`, { headers: { Authorization: basic('Owner', ownerToken.secret) } });
    expect(revoked.status).toBe(401);
  }, 60_000);

  it('serializes completed push before missing-storage recovery and reinitializes the default repository', async () => {
    const createdResponse = await call('POST', 'repositories', ownerCookie, {
      name: 'PushStorageResetRace', visibility: 'PRIVATE', initializeReadme: true,
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { repository: { id: string; storageGeneration: number } };
    expect(created.repository.storageGeneration).toBe(0);
    const stored = await db.repository.findUniqueOrThrow({ where: { id: created.repository.id } });
    const bare = join(storageRoot, stored.storageKey);
    const mainBefore = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();

    const tokenPrefix = randomBytes(8).toString('hex');
    const secret = `cfg_${tokenPrefix}_${randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db.personalAccessToken.create({ data: {
      userId: ownerId, name: 'Push storage recovery acceptance', scopes: ['repo:read', 'repo:write'], expiresAt,
      tokenPrefix, tokenHash: createHash('sha256').update(secret).digest('hex'),
    } });
    const askpass = join(storageRoot, process.platform === 'win32' ? 'push-storage-reset-askpass.cmd' : 'push-storage-reset-askpass.sh');
    await writeFile(askpass, process.platform === 'win32'
      ? '@echo off\r\necho %TEST_GIT_PAT%\r\n'
      : '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
    { mode: 0o700 });
    const run = promisify(execFile);
    const git = (args: string[]) => run('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_USER: 'Owner', TEST_GIT_PAT: secret },
    });
    const work = join(storageRoot, 'push-storage-reset-clone');
    const repoUrl = `${base.replace('http://', 'http://Owner@')}/git/Owner/PushStorageResetRace.git`;
    await git(['clone', repoUrl, work]);
    await git(['-C', work, 'config', 'user.name', 'Push Storage Reset Tester']);
    await git(['-C', work, 'config', 'user.email', 'push-storage-reset@example.test']);
    await git(['-C', work, 'switch', '-c', 'feature/push-before-storage-recovery']);
    await writeFile(join(work, 'storage-recovery.txt'), 'push completes before storage recovery\n');
    await git(['-C', work, 'add', 'storage-recovery.txt']);
    await git(['-C', work, 'commit', '-m', 'Push before missing-storage recovery']);
    const pushedSha = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();

    const hookRoot = join(storageRoot, 'push-storage-reset-hooks');
    const hookStarted = join(storageRoot, 'push-storage-reset-hook-started');
    const hookRelease = join(storageRoot, 'push-storage-reset-hook-release');
    await mkdir(hookRoot, { recursive: true });
    const realHook = resolve(__dirname, '../src/repositories/pre-receive-hook.cjs');
    const barrierHook = `#!/usr/bin/env node
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
    await writeFile(join(hookRoot, 'pre-receive'), barrierHook, { mode: 0o755 });
    const storage = app.get(GitStorageService);
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
    const pushJournal = app.get(GitPushJournalService);
    const originalFinish = pushJournal.finish.bind(pushJournal);
    let finishHasPersisted = false;
    let releaseFinish!: () => void;
    const finishBarrier = new Promise<void>((resolveFinish) => { releaseFinish = resolveFinish; });
    const finishSpy = jest.spyOn(pushJournal, 'finish').mockImplementation(async (...args) => {
      const result = await originalFinish(...args);
      finishHasPersisted = true;
      await finishBarrier;
      return result;
    });
    let pushResult: Awaited<ReturnType<typeof git>> | undefined;
    let pushError: unknown;
    let recoveryResponse: Response | undefined;
    let recoveryError: unknown;
    let pushPromise: Promise<void> | undefined;
    let recoveryPromise: Promise<void> | undefined;
    try {
      pushPromise = git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/push-before-storage-recovery'])
        .then((result) => { pushResult = result; }, (error) => { pushError = error; });
      await waitFor(() => existsSync(hookStarted), 'valid receive-pack to enter pre-receive');

      recoveryPromise = call('GET', 'repos/owner/pushstorageresetrace/branches', ownerCookie)
        .then((response) => { recoveryResponse = response; }, (error) => { recoveryError = error; });
      await waitFor(async () => {
        const rows = await admin.$queryRawUnsafe<{ waiting: number }[]>(`
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
            AND pg_lock.objsubid = 1`, lockApplicationName, stored.id);
        return (rows[0]?.waiting ?? 0) >= 1;
      }, 'missing-storage recovery read to wait on the repository advisory lock');
      expect(recoveryResponse).toBeUndefined();

      await writeFile(hookRelease, 'release');
      await waitFor(() => finishHasPersisted, 'completed push journal to persist while holding the repository lock');
      const completedPush = await db.gitPushOperation.findFirstOrThrow({
        where: { repositoryId: stored.id }, orderBy: { createdAt: 'desc' },
      });
      expect(completedPush).toMatchObject({ status: 'COMPLETED', storageGeneration: 0, changedRefCount: 1, errorCode: null });
      const completedAudit = await db.auditLog.findFirstOrThrow({
        where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' }, orderBy: { createdAt: 'desc' },
      });
      expect(completedAudit.details).toMatchObject({ operationId: completedPush.operationId, storageGeneration: 0, changedRefCount: 1 });
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/feature/push-before-storage-recovery'], { encoding: 'utf8' }).trim())
        .toBe(pushedSha);
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(mainBefore);
      expect(recoveryResponse).toBeUndefined();

      // The Git child has exited and its completed journal/audit/ref are durable;
      // only now simulate ephemeral storage loss while recovery is queued on its lock.
      await rm(bare, { recursive: true, force: true });
      releaseFinish();
      await pushPromise;
      expect(pushError).toBeUndefined();
      expect(pushResult).toBeDefined();
      await recoveryPromise;
      expect(recoveryError).toBeUndefined();
      expect(recoveryResponse?.status).toBe(200);
      expect(await recoveryResponse!.json()).toMatchObject({
        branches: [], defaultBranch: 'main', selectedBranch: null, storageState: 'RESET', storageGeneration: 1,
      });
      expect(await db.repository.findUniqueOrThrow({ where: { id: stored.id } }))
        .toMatchObject({ defaultBranch: 'main', storageGeneration: 1 });
      expect(await db.gitPushOperation.findUniqueOrThrow({ where: { operationId: completedPush.operationId } }))
        .toMatchObject({ status: 'COMPLETED', storageGeneration: 0, changedRefCount: 1 });
      expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' }).trim())
        .toBe('');
      expect(execFileSync('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('refs/heads/main');
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', '--is-bare-repository'], { encoding: 'utf8' }).trim()).toBe('true');
      const recoveredClone = join(storageRoot, 'push-storage-reset-recovered-clone');
      await git(['clone', repoUrl, recoveredClone]);
    } finally {
      if (!existsSync(hookRelease)) await writeFile(hookRelease, 'release').catch(() => undefined);
      releaseFinish();
      if (pushPromise) await pushPromise.catch(() => undefined);
      if (recoveryPromise) await recoveryPromise.catch(() => undefined);
      finishSpy.mockRestore();
      openPack.mockRestore();
      await db.repository.deleteMany({ where: { id: stored.id } });
    }
  }, 60_000);

  it('allows an authorized receive-pack to finish after account lock', async () => {
    const created = await call('POST', 'repositories', ownerCookie, { name: 'PushUserLockRace', initializeReadme: true });
    expect(created.status).toBe(201);
    const { repository } = await created.json() as { repository: { id: string } };
    const stored = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, stored.storageKey);
    const tokenResponse = await call('POST', 'tokens', ownerCookie, {
      name: 'Push user-lock race', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(tokenResponse.status).toBe(201);
    const { secret, token } = await tokenResponse.json() as { secret: string; token: { id: string } };
    const work = join(storageRoot, 'push-user-lock-race-clone');
    const hookRoot = join(storageRoot, 'push-user-lock-race-hooks');
    const hookStarted = join(storageRoot, 'push-user-lock-race-hook-started');
    const hookRelease = join(storageRoot, 'push-user-lock-race-hook-release');
    const askpass = join(storageRoot, process.platform === 'win32' ? 'push-user-lock-askpass.cmd' : 'push-user-lock-askpass.sh');
    const run = promisify(execFile);
    await writeFile(askpass, process.platform === 'win32'
      ? '@echo off\r\necho %TEST_GIT_PAT%\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$TEST_GIT_PAT"\n', { mode: 0o700 });
    const git = (args: string[]) => run('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-user-lock-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_PAT: secret },
    });
    const repoUrl = `${base.replace('http://', 'http://Owner@')}/git/Owner/PushUserLockRace.git`;
    await git(['clone', repoUrl, work]);
    await git(['-C', work, 'config', 'user.name', 'Push User Lock Tester']);
    await git(['-C', work, 'config', 'user.email', 'push-user-lock@example.test']);
    await git(['-C', work, 'switch', '-c', 'feature/push-before-user-lock']);
    await writeFile(join(work, 'race.txt'), 'authorized push completes after actor lock\n');
    await git(['-C', work, 'add', 'race.txt']);
    await git(['-C', work, 'commit', '-m', 'Push before account lock']);
    const pushedSha = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();

    await mkdir(hookRoot, { recursive: true });
    const realHook = resolve(__dirname, '../src/repositories/pre-receive-hook.cjs');
    const barrierHook = `#!/usr/bin/env node
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
    await writeFile(join(hookRoot, 'pre-receive'), barrierHook, { mode: 0o755 });
    const storage = app.get(GitStorageService);
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
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    let pushResult: Awaited<ReturnType<typeof git>> | undefined;
    let pushError: unknown;
    let pushPromise: Promise<void> | undefined;
    try {
      pushPromise = git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/push-before-user-lock'])
        .then((result) => { pushResult = result; }, (error) => { pushError = error; });
      await waitFor(() => existsSync(hookStarted), 'authorized receive-pack to enter pre-receive');

      await db.user.update({ where: { id: ownerId }, data: { status: 'LOCKED', lockedAt: new Date() } });
      expect(await db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { status: true } })).toMatchObject({ status: 'LOCKED' });

      await writeFile(hookRelease, 'release');
      await pushPromise;
      expect(pushError).toBeUndefined();
      expect(pushResult).toBeDefined();
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/feature/push-before-user-lock'], { encoding: 'utf8' }).trim())
        .toBe(pushedSha);

      const operations = await db.gitPushOperation.findMany({ where: { repositoryId: stored.id, actorId: ownerId } });
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({ status: 'COMPLETED', changedRefCount: 1, errorCode: null });
      const pushAudits = await db.auditLog.findMany({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } });
      expect(pushAudits).toHaveLength(1);
      expect(pushAudits[0]).toMatchObject({ actorId: ownerId, details: {
        operationId: operations[0]!.operationId, repositoryId: stored.id, storageGeneration: stored.storageGeneration, changedRefCount: 1,
      } });
      expect(JSON.stringify(pushAudits[0]?.details).includes(secret)).toBe(false);

      const refsAfterFirstPush = execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' });
      const rejectedAdvertisement = await fetch(`${base}/git/Owner/PushUserLockRace.git/info/refs?service=git-receive-pack`, {
        headers: { Authorization: `Basic ${Buffer.from(`Owner:${secret}`).toString('base64')}` },
      });
      expect(rejectedAdvertisement.status).toBe(401);
      await writeFile(join(work, 'after-lock.txt'), 'must remain local\n');
      await git(['-C', work, 'add', 'after-lock.txt']);
      await git(['-C', work, 'commit', '-m', 'Attempt push after account lock']);
      await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/feature/after-user-lock'])).rejects.toBeDefined();
      expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' }))
        .toBe(refsAfterFirstPush);
      expect(await db.gitPushOperation.count({ where: { repositoryId: stored.id, actorId: ownerId } })).toBe(1);
      expect(await db.auditLog.count({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } })).toBe(1);
    } finally {
      if (!existsSync(hookRelease)) await writeFile(hookRelease, 'release').catch(() => undefined);
      if (pushPromise) await pushPromise.catch(() => undefined);
      openPack.mockRestore();
      await db.personalAccessToken.deleteMany({ where: { id: token.id, userId: ownerId } });
      await db.user.update({ where: { id: ownerId }, data: { status: 'ACTIVE', lockedAt: null } });
      await db.repository.deleteMany({ where: { id: stored.id } });
    }
  }, 60_000);

  it('rejects a queued receive-pack when the actor is locked before repository lock acquisition', async () => {
    const created = await call('POST', 'repositories', ownerCookie, { name: 'QueuedPushUserLock', initializeReadme: true });
    expect(created.status).toBe(201);
    const { repository } = await created.json() as { repository: { id: string } };
    const stored = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, stored.storageKey);
    const refsBefore = execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' });
    const tokenResponse = await call('POST', 'tokens', ownerCookie, {
      name: 'Queued push user-lock race', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(tokenResponse.status).toBe(201);
    const { secret, token } = await tokenResponse.json() as { secret: string; token: { id: string } };
    const barrier = new Client({ connectionString: originalUrl });
    const storage = app.get(GitStorageService);
    const openPack = jest.spyOn(storage, 'openPack');
    const url = `${base}/git/Owner/QueuedPushUserLock.git/git-receive-pack`;
    const requestController = new AbortController();
    let barrierHeld = false;
    let userLocked = false;
    let requestPromise: Promise<Response> | undefined;
    let response: Response | undefined;
    const unlockBarrier = async () => {
      if (!barrierHeld) return;
      const result = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [stored.id]);
      if (!result.rows[0]?.pg_advisory_unlock) throw new Error('The queued-push barrier lock was not held.');
      barrierHeld = false;
    };
    const waitForQueuedReceivePack = async () => {
      const deadline = Date.now() + 5_000;
      do {
        const waiters = await admin.$queryRawUnsafe<{ waiting: number }[]>(`
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
            AND pg_lock.objsubid = 1`, lockApplicationName, stored.id);
        if ((waiters[0]?.waiting ?? 0) === 1) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      throw new Error('Timed out waiting for receive-pack to queue on the repository advisory lock.');
    };

    try {
      await barrier.connect();
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [stored.id]);
      barrierHeld = true;
      requestPromise = fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`Owner:${secret}`).toString('base64')}`,
          'content-type': 'application/x-git-receive-pack-request',
        },
        body: Buffer.from('0000'),
        signal: requestController.signal,
      });
      await waitForQueuedReceivePack();

      userLocked = true;
      await db.user.update({ where: { id: ownerId }, data: { status: 'LOCKED', lockedAt: new Date() } });
      await unlockBarrier();
      response = await requestPromise;

      expect(response.status).toBe(401);
      expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' }))
        .toBe(refsBefore);
      expect(await db.gitPushOperation.count({ where: { repositoryId: stored.id } })).toBe(0);
      expect(await db.auditLog.count({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } })).toBe(0);
      expect(openPack).not.toHaveBeenCalled();

      const lockProbe = await barrier.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [stored.id]);
      expect(lockProbe.rows[0]?.acquired).toBe(true);
      const probeUnlock = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [stored.id]);
      expect(probeUnlock.rows[0]?.pg_advisory_unlock).toBe(true);
    } finally {
      if (barrierHeld) await unlockBarrier();
      if (requestPromise && !response) {
        requestController.abort();
        await requestPromise.catch(() => undefined);
      }
      openPack.mockRestore();
      if (userLocked) await db.user.update({ where: { id: ownerId }, data: { status: 'ACTIVE', lockedAt: null } });
      await db.personalAccessToken.deleteMany({ where: { id: token.id, userId: ownerId } });
      await db.repository.deleteMany({ where: { id: stored.id } });
      await barrier.end();
    }
  }, 60_000);

  it('serializes a valid Git push before repository soft-delete and rejects later writes', async () => {
    const created = await call('POST', 'repositories', ownerCookie, { name: 'PushDeleteRace', initializeReadme: true });
    expect(created.status).toBe(201);
    const { repository } = await created.json() as { repository: { id: string } };
    const stored = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const bare = join(storageRoot, stored.storageKey);
    const tokenResponse = await call('POST', 'tokens', ownerCookie, {
      name: 'Push-delete race', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(tokenResponse.status).toBe(201);
    const { secret } = await tokenResponse.json() as { secret: string };
    const work = join(storageRoot, 'push-delete-race-clone');
    const hookRoot = join(storageRoot, 'push-delete-race-hooks');
    const hookStarted = join(storageRoot, 'push-delete-race-hook-started');
    const hookRelease = join(storageRoot, 'push-delete-race-hook-release');
    const askpass = join(storageRoot, process.platform === 'win32' ? 'push-delete-askpass.cmd' : 'push-delete-askpass.sh');
    const run = promisify(execFile);
    await writeFile(askpass, process.platform === 'win32'
      ? '@echo off\r\necho %TEST_GIT_PAT%\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$TEST_GIT_PAT"\n', { mode: 0o700 });
    const git = (args: string[]) => run('git', ['-c', 'credential.helper=', ...args], {
      timeout: 20_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(storageRoot, 'empty-git-config'),
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, TEST_GIT_PAT: secret },
    });
    const repoUrl = `${base.replace('http://', 'http://Owner@')}/git/Owner/PushDeleteRace.git`;
    await git(['clone', repoUrl, work]);
    await git(['-C', work, 'config', 'user.name', 'Push Delete Tester']);
    await git(['-C', work, 'config', 'user.email', 'push-delete@example.test']);
    await git(['-C', work, 'switch', '-c', 'feature/push-before-delete']);
    await writeFile(join(work, 'race.txt'), 'push completes before delete\n');
    await git(['-C', work, 'add', 'race.txt']);
    await git(['-C', work, 'commit', '-m', 'Push before repository deletion']);
    const pushedSha = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();

    await mkdir(hookRoot, { recursive: true });
    const realHook = resolve(__dirname, '../src/repositories/pre-receive-hook.cjs');
    const barrierHook = `#!/usr/bin/env node
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
    await writeFile(join(hookRoot, 'pre-receive'), barrierHook, { mode: 0o755 });
    const storage = app.get(GitStorageService);
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
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    let deleteResponse: Response | undefined;
    let pushResult: Awaited<ReturnType<typeof git>> | undefined;
    let pushError: unknown;
    let deletePromise: Promise<Response> | undefined;
    let pushPromise: Promise<void> | undefined;
    try {
      pushPromise = git(['-C', work, 'push', '--set-upstream', 'origin', 'feature/push-before-delete'])
        .then((result) => { pushResult = result; }, (error) => { pushError = error; });
      await waitFor(() => existsSync(hookStarted), 'valid receive-pack to enter pre-receive');

      deletePromise = call('DELETE', 'repos/owner/pushdeleterace', ownerCookie)
        .then((response) => { deleteResponse = response; return response; });
      await waitFor(async () => {
        const rows = await admin.$queryRawUnsafe<{ waiting: number }[]>(`
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
            AND pg_lock.objsubid = 1`, lockApplicationName, stored.id);
        return (rows[0]?.waiting ?? 0) >= 1;
      }, 'soft-delete to wait on the repository advisory lock');
      expect(deleteResponse).toBeUndefined();

      await writeFile(hookRelease, 'release');
      await pushPromise;
      expect(pushError).toBeUndefined();
      expect(pushResult).toBeDefined();
      expect((await db.gitPushOperation.findMany({ where: { repositoryId: stored.id } }))
        .filter(({ status }) => status === 'COMPLETED')).toHaveLength(1);
      const pushAudits = await db.auditLog.findMany({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } });
      expect(pushAudits).toHaveLength(1);
      expect(pushAudits[0]?.details).toMatchObject({ repositoryId: stored.id, changedRefCount: 1 });
      expect(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/feature/push-before-delete'], { encoding: 'utf8' }).trim())
        .toBe(pushedSha);

      deleteResponse = await deletePromise;
      expect(deleteResponse.status).toBe(204);
      expect(await db.repository.findUniqueOrThrow({ where: { id: stored.id } })).toMatchObject({ status: 'DELETED' });
      expect(await db.auditLog.count({ where: { targetId: stored.id, action: 'REPOSITORY_SOFT_DELETED' } })).toBe(1);

      await writeFile(join(work, 'after-delete.txt'), 'must remain local\n');
      await git(['-C', work, 'add', 'after-delete.txt']);
      await git(['-C', work, 'commit', '-m', 'Attempt push after deletion']);
      const refsAfterDelete = execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' });
      await expect(git(['-C', work, 'push', 'origin', 'HEAD:refs/heads/feature/after-delete'])).rejects.toBeDefined();
      expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' }))
        .toBe(refsAfterDelete);
      expect(await db.auditLog.count({ where: { targetId: stored.id, action: 'GIT_PUSH_COMPLETED' } })).toBe(1);
    } finally {
      if (!existsSync(hookRelease)) await writeFile(hookRelease, 'release').catch(() => undefined);
      if (pushPromise) await pushPromise.catch(() => undefined);
      if (deletePromise && !deleteResponse) await deletePromise.catch(() => undefined);
      openPack.mockRestore();
      await db.repository.deleteMany({ where: { id: stored.id } });
    }
  }, 60_000);

  it('updates metadata, clears description, normalizes rename and applies visibility immediately', async () => {
    const path = 'repos/owner/demo';
    expect((await call('PATCH', path, ownerCookie, {})).status).toBe(400);
    for (const body of [{ name: null }, { visibility: null }, { status: 'DELETED' }, { name: '../x' }]) {
      expect((await call('PATCH', path, ownerCookie, body)).status).toBe(400);
    }
    expect((await call('PATCH', path, ownerCookie, { name: 'PUBLIC' })).status).toBe(409);
    const before = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'demo' } });
    const changed = await call('PATCH', path, ownerCookie, { name: 'Renamed', description: null, visibility: 'PUBLIC' });
    expect(changed.status).toBe(200);
    expect((await changed.json()).repository).toMatchObject({ id: before.id, name: 'Renamed', description: null, visibility: 'PUBLIC' });
    expect((await call('GET', path, ownerCookie)).status).toBe(404);
    expect((await call('GET', 'repos/owner/renamed')).status).toBe(200);
    expect((await call('PATCH', 'repos/owner/renamed', ownerCookie, { visibility: 'PRIVATE' })).status).toBe(200);
    expect((await call('GET', 'repos/owner/renamed')).status).toBe(404);
    expect((await db.repository.findUniqueOrThrow({ where: { id: before.id } })).storageKey).toBe(before.storageKey);
    expect(await db.auditLog.count({ where: { targetId: before.id, action: 'REPOSITORY_UPDATED' } })).toBe(2);
  });

  it('blocks repository deletion while an unresolved Git push journal exists', async () => {
    const id = randomUUID();
    const name = 'UnresolvedPushDelete';
    const storageKey = `${id}.git`;
    const operationId = randomUUID();
    const storage = app.get(GitStorageService);
    let repositoryCreated = false;
    try {
      const stored = await db.repository.create({ data: {
        id, ownerId, name, normalizedName: name.toLowerCase(), storageKey, visibility: 'PRIVATE',
      } });
      repositoryCreated = true;
      await storage.create(storageKey, stored.defaultBranch, true, name);
      const bare = join(storageRoot, storageKey);
      const refsBefore = execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--sort=refname',
        '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' });
      const beforeRefs = { 'refs/heads/main': execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim() };
      const operation = await db.gitPushOperation.create({ data: {
        operationId, repositoryId: stored.id, actorId: ownerId, storageGeneration: stored.storageGeneration,
        beforeRefs, status: 'NEEDS_RECONCILIATION', errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN',
      } });

      const response = await call('DELETE', `repos/owner/${name.toLowerCase()}`, ownerCookie);

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('GIT_PUSH_RECONCILIATION_REQUIRED');
      expect(await db.repository.findUniqueOrThrow({ where: { id: stored.id } }))
        .toMatchObject({ status: 'ACTIVE', storageGeneration: stored.storageGeneration });
      expect(execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--sort=refname',
        '--format=%(refname)%09%(objectname)', 'refs/'], { encoding: 'utf8' })).toBe(refsBefore);
      expect(await db.gitPushOperation.findUniqueOrThrow({ where: { operationId } }))
        .toMatchObject({ status: 'NEEDS_RECONCILIATION', errorCode: 'GIT_CHILD_OUTCOME_UNKNOWN',
          storageGeneration: stored.storageGeneration, beforeRefs: operation.beforeRefs });
      expect(await db.auditLog.count({ where: { targetId: stored.id, action: 'REPOSITORY_SOFT_DELETED' } })).toBe(0);
    } finally {
      await db.gitPushOperation.deleteMany({ where: { operationId } });
      await storage.remove(storageKey);
      if (repositoryCreated) await db.repository.deleteMany({ where: { id } });
    }
  });

  it('soft-deletes, computes configured retention and reserves the deleted name', async () => {
    expect((await call('DELETE', 'repos/owner/renamed', ownerCookie)).status).toBe(204);
    const deleted = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'renamed' } });
    expect(deleted.status).toBe('DELETED');
    expect(deleted.purgeAfter!.getTime() - deleted.deletedAt!.getTime()).toBe(7 * 86400000);
    expect(await db.auditLog.count({ where: { targetId: deleted.id, action: 'REPOSITORY_SOFT_DELETED' } })).toBe(1);
    for (const cookies of ['', ownerCookie, otherCookie]) {
      expect((await call('GET', 'repos/owner/renamed', cookies)).status).toBe(404);
      expect((await call('GET', 'repos/owner/renamed/branches', cookies)).status).toBe(404);
      expect((await call('GET', 'repos/owner/renamed/tree', cookies)).status).toBe(404);
      expect((await call('GET', 'repos/owner/renamed/blob?path=README.md', cookies)).status).toBe(404);
      expect((await call('GET', 'repos/owner/renamed/image?path=logo.png', cookies)).status).toBe(404);
      expect((await call('GET', 'repos/owner/renamed/commits', cookies)).status).toBe(404);
      expect((await call('GET', `repos/owner/renamed/commits/${'a'.repeat(40)}`, cookies)).status).toBe(404);
    }
    expect((await call('PATCH', 'repos/owner/renamed', ownerCookie, { name: 'Restored' })).status).toBe(404);
    expect((await call('DELETE', 'repos/owner/renamed', ownerCookie)).status).toBe(404);
    expect((await create('RENAMED')).status).toBe(409);
  });

  it('lists only the owner deleted repositories and restores within retention', async () => {
    const path = 'repos/owner/renamed/restore';
    expect((await call('GET', 'repositories/deleted')).status).toBe(401);
    expect((await call('POST', path)).status).toBe(401);
    expect((await call('POST', path, otherCookie)).status).toBe(404);
    expect((await call('POST', path, ownerCookie, undefined, 'https://evil.example')).status).toBe(403);
    expect((await (await call('GET', 'repositories/deleted', otherCookie)).json()).repositories).toEqual([]);
    const listed = await (await call('GET', 'repositories/deleted', ownerCookie)).json();
    expect(listed.repositories).toHaveLength(1);
    expect(listed.repositories[0]).toMatchObject({ name: 'Renamed', status: 'DELETED' });
    expect(listed.repositories[0].storageKey).toBeUndefined();
    const restored = await call('POST', path, ownerCookie);
    expect(restored.status).toBe(201);
    expect((await restored.json()).repository).toMatchObject({ name: 'Renamed', status: 'ACTIVE' });
    expect((await call('GET', 'repos/owner/renamed', ownerCookie)).status).toBe(200);
    expect(await db.auditLog.count({ where: { targetId: (await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'renamed' } })).id,
      action: 'REPOSITORY_RESTORED' } })).toBe(1);
    expect((await (await call('GET', 'repositories/deleted', ownerCookie)).json()).repositories).toEqual([]);
    expect((await call('POST', path, ownerCookie)).status).toBe(404);
    expect((await call('DELETE', 'repos/owner/renamed', ownerCookie)).status).toBe(204);
  });

  it('rejects expired restore and purges source and metadata before reusing the name', async () => {
    const repo = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'renamed' } });
    const bare = join(storageRoot, repo.storageKey);
    await db.repository.update({ where: { id: repo.id }, data: { purgeAfter: new Date(Date.now() - 1000) } });
    expect((await (await call('POST', 'repos/owner/renamed/restore', ownerCookie)).json()).error.code).toBe('RESTORE_EXPIRED');
    expect((await (await call('GET', 'repositories/deleted', ownerCookie)).json()).repositories).toEqual([]);
    const failedRemoval = jest.spyOn(app.get(GitStorageService), 'remove').mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await app.get(RepositoryPurgeService).purgeDue()).toBe(0);
    expect(await db.repository.findUnique({ where: { id: repo.id } })).not.toBeNull();
    failedRemoval.mockRestore();
    expect(await app.get(RepositoryPurgeService).purgeDue()).toBe(1);
    expect(await db.repository.findUnique({ where: { id: repo.id } })).toBeNull();
    expect(() => execFileSync('git', ['--git-dir', bare, 'rev-parse', '--is-bare-repository'], { stdio: 'pipe' })).toThrow();
    expect((await create('RENAMED')).status).toBe(201);
  });

  it('serializes concurrent creates and counts soft-deleted repositories toward quota', async () => {
    const results = await Promise.all([create('LastOne'), create('LastTwo')]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 403]);
    expect(await (results.find((res) => res.status === 403)!).json()).toMatchObject({
      error: { code: 'REPOSITORY_QUOTA_EXCEEDED' },
    });
    expect(await db.repository.count({ where: { ownerId } })).toBe(3);
    expect((await create('OverQuota')).status).toBe(403);
  });

  it('blocks locked accounts from writes while keeping their active public repositories readable', async () => {
    await db.user.update({ where: { id: ownerId }, data: { status: 'LOCKED' } });
    expect((await create('Blocked')).status).toBe(401);
    expect((await call('PATCH', 'repos/owner/public', ownerCookie, { name: 'Blocked' })).status).toBe(401);
    expect((await call('DELETE', 'repos/owner/public', ownerCookie)).status).toBe(401);
    expect((await call('GET', 'repos/owner/public')).status).toBe(200);
    await db.user.update({ where: { id: ownerId }, data: { status: 'ACTIVE' } });
    await db.repository.updateMany({ where: { ownerId, normalizedName: 'public' }, data: { status: 'LOCKED' } });
    expect((await call('GET', 'repos/owner/public')).status).toBe(404);
    expect((await call('GET', 'repos/owner/public', ownerCookie)).status).toBe(404);
    expect((await call('PATCH', 'repos/owner/public', ownerCookie, { visibility: 'PRIVATE' })).status).toBe(404);
  });

  it('M5 manages invitations, enforces lifecycle, and controls member READ/WRITE roles immediately', async () => {
    // 1. Register Bob
    const bobRes = await call('POST', 'auth/register', '', {
      username: 'BobUser', email: 'bob@example.test', password: 'test-password-123',
    });
    expect(bobRes.status).toBe(201);
    const bobCookie = cookie(bobRes);
    const bobId = (await bobRes.json()).user.id;

    // Use a clean private repository owned by Owner (free up quota from earlier test)
    await db.repository.deleteMany({ where: { ownerId, normalizedName: { in: ['lastone', 'lasttwo'] } } });
    const repoRes = await create('M5Repo', 'PRIVATE');
    expect(repoRes.status).toBe(201);
    const repoPath = 'repos/owner/m5repo';

    // 2. Validate invitations input & authorization
    // Anonymous / unauthenticated
    expect((await call('POST', `${repoPath}/invitations`, '', { username: 'BobUser', role: 'READ' })).status).toBe(401);
    // Non-owner (Other)
    expect((await call('POST', `${repoPath}/invitations`, otherCookie, { username: 'BobUser', role: 'READ' })).status).toBe(404);
    // Untrusted origin
    expect((await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'READ' }, 'https://evil.example')).status).toBe(403);
    // Cannot invite owner
    const selfInvite = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'Owner', role: 'READ' });
    expect(selfInvite.status).toBe(400);
    expect((await selfInvite.json()).error.code).toBe('CANNOT_INVITE_OWNER');
    // Non-existent user
    const missingInvite = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'nonexistent', role: 'READ' });
    expect(missingInvite.status).toBe(404);
    expect((await missingInvite.json()).error.code).toBe('USER_NOT_FOUND');
    // Invalid role
    expect((await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'ADMIN' })).status).toBe(400);

    // 3. Owner invites Bob with WRITE
    const inviteRes = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'bobuser', role: 'WRITE' });
    expect(inviteRes.status).toBe(201);
    const { invitation: firstInvite } = await inviteRes.json();
    expect(firstInvite).toMatchObject({
      role: 'WRITE',
      status: 'PENDING',
      invitee: { id: bobId, username: 'BobUser' },
    });

    // Cannot create duplicate pending invitation
    const dupInvite = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'READ' });
    expect(dupInvite.status).toBe(409);
    expect((await dupInvite.json()).error.code).toBe('INVITATION_ALREADY_EXISTS');

    // Owner can list invitations
    const repoInvs = await call('GET', `${repoPath}/invitations`, ownerCookie);
    expect(repoInvs.status).toBe(200);
    expect((await repoInvs.json()).invitations).toHaveLength(1);

    // Bob sees the pending invitation
    const bobInvs = await call('GET', 'invitations', bobCookie);
    expect(bobInvs.status).toBe(200);
    const bobInvsData = await bobInvs.json();
    expect(bobInvsData.invitations).toHaveLength(1);
    expect(bobInvsData.invitations[0]).toMatchObject({
      id: firstInvite.id,
      role: 'WRITE',
      status: 'PENDING',
      repository: { name: 'M5Repo', owner: { username: 'Owner' } },
    });

    // Before accepting, Bob has no access to private repository
    expect((await call('GET', repoPath, bobCookie)).status).toBe(404);

    // 4. Test Revoke
    // Non-owner cannot revoke
    expect((await call('DELETE', `${repoPath}/invitations/${firstInvite.id}`, bobCookie)).status).toBe(404);
    // Owner revokes
    const revokeRes = await call('DELETE', `${repoPath}/invitations/${firstInvite.id}`, ownerCookie);
    expect(revokeRes.status).toBe(204);

    // Bob cannot accept a revoked invitation
    const acceptRevoked = await call('POST', `invitations/${firstInvite.id}/accept`, bobCookie);
    expect(acceptRevoked.status).toBe(409);
    expect((await acceptRevoked.json()).error.code).toBe('INVITATION_NOT_PENDING');

    // Accept and revoke must serialize on the repository lock. Hold that lock
    // until PostgreSQL confirms both HTTP requests are queued behind it.
    const raceInviteResponse = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'WRITE' });
    expect(raceInviteResponse.status).toBe(201);
    const { invitation: raceInvite } = await raceInviteResponse.json();
    const m5Repository = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'm5repo' } });
    const barrier = new Client({ connectionString: originalUrl });
    let barrierHeld = false;
    let raceRequests: [Promise<Response>, Promise<Response>] | undefined;
    const unlockBarrier = async () => {
      if (!barrierHeld) return;
      const result = await barrier.query<{ pg_advisory_unlock: boolean }>(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))', [m5Repository.id]);
      if (!result.rows[0]?.pg_advisory_unlock) throw new Error('The invitation-race barrier lock was not held.');
      barrierHeld = false;
    };
    const waitForBothInvitationTransitions = async () => {
      const deadline = Date.now() + 5_000;
      do {
        const waiters = await admin.$queryRawUnsafe<{ waiting: number }[]>(`
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
            AND pg_lock.objsubid = 1`, lockApplicationName, m5Repository.id);
        if ((waiters[0]?.waiting ?? 0) === 2) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      throw new Error('Timed out waiting for accept and revoke to queue on the repository advisory lock.');
    };

    try {
      await barrier.connect();
      await barrier.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [m5Repository.id]);
      barrierHeld = true;
      raceRequests = [
        call('DELETE', `${repoPath}/invitations/${raceInvite.id}`, ownerCookie),
        call('POST', `invitations/${raceInvite.id}/accept`, bobCookie),
      ];
      await waitForBothInvitationTransitions();
      await unlockBarrier();

      const activeRaceRequests = raceRequests;
      if (!activeRaceRequests) throw new Error('Invitation-race requests were not started.');
      const [revokeRaceResponse, acceptRaceResponse] = await Promise.all(activeRaceRequests);
      const raceResults = [
        { kind: 'REVOKED', response: revokeRaceResponse },
        { kind: 'ACCEPTED', response: acceptRaceResponse },
      ];
      const winners = raceResults.filter(({ response }) => response.status === 204 || response.status === 201);
      const losers = raceResults.filter(({ response }) => response.status === 409);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((await losers[0]!.response.json()).error.code).toBe('INVITATION_NOT_PENDING');

      const resultingInvitation = await db.invitation.findUniqueOrThrow({ where: { id: raceInvite.id } });
      const resultingMembership = await db.repositoryMember.findUnique({
        where: { repositoryId_userId: { repositoryId: m5Repository.id, userId: bobId } },
      });
      const repositoryMembershipCount = await db.repositoryMember.count({ where: { repositoryId: m5Repository.id } });
      const transitionAudits = await db.auditLog.findMany({
        where: { targetId: raceInvite.id, action: { in: ['INVITATION_ACCEPTED', 'INVITATION_REVOKED'] } },
      });
      expect(transitionAudits).toHaveLength(1);
      if (winners[0]!.kind === 'ACCEPTED') {
        expect(acceptRaceResponse.status).toBe(201);
        expect(revokeRaceResponse.status).toBe(409);
        expect(resultingInvitation.status).toBe('ACCEPTED');
        expect(resultingMembership).toMatchObject({ repositoryId: m5Repository.id, userId: bobId, role: 'WRITE' });
        expect(repositoryMembershipCount).toBe(1);
        expect(transitionAudits[0]!.action).toBe('INVITATION_ACCEPTED');
      } else {
        expect(revokeRaceResponse.status).toBe(204);
        expect(acceptRaceResponse.status).toBe(409);
        expect(resultingInvitation.status).toBe('REVOKED');
        expect(resultingMembership).toBeNull();
        expect(repositoryMembershipCount).toBe(0);
        expect(transitionAudits[0]!.action).toBe('INVITATION_REVOKED');
      }
    } finally {
      await unlockBarrier();
      if (raceRequests) await Promise.allSettled(raceRequests);
      await db.repositoryMember.deleteMany({ where: { repositoryId: m5Repository.id, userId: bobId } });
      await db.auditLog.deleteMany({ where: { targetId: raceInvite.id, action: { in: ['INVITATION_ACCEPTED', 'INVITATION_REVOKED'] } } });
      await db.invitation.deleteMany({ where: { id: raceInvite.id } });
      await barrier.end();
    }

    // 5. Re-invite and Decline
    const invite2 = await (await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'READ' })).json();
    const declineRes = await call('POST', `invitations/${invite2.invitation.id}/decline`, bobCookie);
    expect(declineRes.status).toBe(201);
    expect((await declineRes.json()).success).toBe(true);

    // Cannot accept declined invitation
    expect((await call('POST', `invitations/${invite2.invitation.id}/accept`, bobCookie)).status).toBe(409);

    // 6. Invite Bob with WRITE and Accept
    const invite3 = await (await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'WRITE' })).json();
    const acceptRes = await call('POST', `invitations/${invite3.invitation.id}/accept`, bobCookie);
    expect(acceptRes.status).toBe(201);
    expect((await acceptRes.json()).success).toBe(true);

    // Once accepted, Bob has WRITE permissions immediately
    const bobAccess = await call('GET', repoPath, bobCookie);
    expect(bobAccess.status).toBe(200);
    expect((await bobAccess.json()).repository.permissions).toEqual({
      canRead: true, canWrite: true, canManage: false,
    });

    // Cannot invite Bob again because he is already a member
    const alreadyMemberInvite = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'READ' });
    expect(alreadyMemberInvite.status).toBe(409);
    expect((await alreadyMemberInvite.json()).error.code).toBe('ALREADY_MEMBER');

    // Members list shows Bob with WRITE
    const membersList = await call('GET', `${repoPath}/members`, ownerCookie);
    expect(membersList.status).toBe(200);
    const membersData = await membersList.json();
    expect(membersData.members).toHaveLength(1);
    expect(membersData.members[0]).toMatchObject({
      userId: bobId,
      role: 'WRITE',
      user: { username: 'BobUser' },
    });

    // 7. Change role from WRITE to READ
    // Member without owner rights gets 403 Forbidden; non-member gets 404 Not Found
    expect((await call('PATCH', `${repoPath}/members/${bobId}`, bobCookie, { role: 'READ' })).status).toBe(403);
    expect((await call('PATCH', `${repoPath}/members/${bobId}`, otherCookie, { role: 'READ' })).status).toBe(404);
    // Owner changes role to READ
    const patchRole = await call('PATCH', `${repoPath}/members/${bobId}`, ownerCookie, { role: 'READ' });
    expect(patchRole.status).toBe(200);
    expect((await patchRole.json()).member.role).toBe('READ');

    // Bob's permissions immediately reflect role downgrade
    const bobDowngraded = await call('GET', repoPath, bobCookie);
    expect((await bobDowngraded.json()).repository.permissions).toEqual({
      canRead: true, canWrite: false, canManage: false,
    });

    // 8. Remove member
    // Member gets 403; non-member gets 404
    expect((await call('DELETE', `${repoPath}/members/${bobId}`, bobCookie)).status).toBe(403);
    expect((await call('DELETE', `${repoPath}/members/${bobId}`, otherCookie)).status).toBe(404);
    // Owner removes Bob
    const removeRes = await call('DELETE', `${repoPath}/members/${bobId}`, ownerCookie);
    expect(removeRes.status).toBe(204);

    // Owner cannot modify or delete owner
    expect((await call('PATCH', `${repoPath}/members/${ownerId}`, ownerCookie, { role: 'READ' })).status).toBe(400);
    expect((await call('DELETE', `${repoPath}/members/${ownerId}`, ownerCookie)).status).toBe(400);

    // 9. Accepting an expired invitation persists EXPIRED without granting membership; re-inviting then succeeds
    const m5Repo = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'm5repo' } });
    const expiredInvite = await db.invitation.create({
      data: {
        id: randomUUID(),
        repositoryId: m5Repo.id,
        inviterId: ownerId,
        inviteeId: bobId,
        role: 'READ',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 10_000),
      },
    });
    const acceptExpired = await call('POST', `invitations/${expiredInvite.id}/accept`, bobCookie);
    expect(acceptExpired.status).toBe(409);
    expect((await acceptExpired.json()).error.code).toBe('INVITATION_EXPIRED');
    expect((await db.invitation.findUniqueOrThrow({ where: { id: expiredInvite.id } })).status).toBe('EXPIRED');
    expect(await db.repositoryMember.count({ where: { repositoryId: m5Repo.id, userId: bobId } })).toBe(0);

    const reInviteExpired = await call('POST', `${repoPath}/invitations`, ownerCookie, { username: 'BobUser', role: 'READ' });
    expect(reInviteExpired.status).toBe(201);
    expect(await db.invitation.count({ where: { repositoryId: m5Repo.id, inviteeId: bobId, status: 'EXPIRED' } })).toBe(1);

    // 10. Verify Audit logs
    expect(await db.auditLog.count({ where: { action: 'INVITATION_CREATED' } })).toBeGreaterThanOrEqual(3);
    expect(await db.auditLog.count({ where: { action: 'INVITATION_REVOKED' } })).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.count({ where: { action: 'INVITATION_DECLINED' } })).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.count({ where: { action: 'INVITATION_ACCEPTED' } })).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.count({ where: { action: 'MEMBER_ROLE_UPDATED' } })).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.count({ where: { action: 'MEMBER_REMOVED' } })).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

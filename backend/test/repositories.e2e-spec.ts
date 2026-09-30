import { randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser = require('cookie-parser');
import { RepositoryPurgeService } from '../src/repositories/repository-purge.service';
import { GitStorageService } from '../src/repositories/git-storage.service';

describe('Repository HTTP + PostgreSQL', () => {
  const schema = `repo_test_${randomBytes(8).toString('hex')}`;
  let db: PrismaClient;
  let admin: PrismaClient;
  let app: INestApplication;
  let base: string;
  let origin: string;
  let ownerCookie: string;
  let otherCookie: string;
  let ownerId: string;
  let originalUrl: string | undefined;
  let originalQuota: string | undefined;
  let originalRetention: string | undefined;
  let originalStorage: string | undefined;
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
    originalQuota = process.env.MAX_REPOSITORIES_PER_USER;
    originalRetention = process.env.SOFT_DELETE_RETENTION_DAYS;
    originalStorage = process.env.GIT_STORAGE_PATH;
    storageRoot = await mkdtemp(join(tmpdir(), 'code-forge-repositories-'));
    process.env.GIT_STORAGE_PATH = storageRoot;
    if (!originalUrl) throw new Error('DATABASE_URL is required for integration tests');
    admin = new PrismaClient({ datasourceUrl: originalUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const url = new URL(originalUrl);
    url.searchParams.set('schema', schema);
    process.env.DATABASE_URL = url.toString();
    process.env.MAX_REPOSITORIES_PER_USER = '3';
    process.env.SOFT_DELETE_RETENTION_DAYS = '7';
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    if (admin && app) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
    for (const [key, value] of Object.entries({
      DATABASE_URL: originalUrl, MAX_REPOSITORIES_PER_USER: originalQuota,
      SOFT_DELETE_RETENTION_DAYS: originalRetention,
      GIT_STORAGE_PATH: originalStorage,
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
      permissions: { canRead: true, canManage: true } });
    expect(repository.storageKey).toBeUndefined();
    expect(repository.owner.email).toBeUndefined();
    const stored = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
    expect(stored.storageKey).toBe(`${repository.id}.git`);
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
    expect(await hidden.json()).toEqual(await (await call('GET', 'repos/owner/missing', otherCookie)).json());
    expect((await call('GET', 'repos/owner/demo')).status).toBe(404);
    expect((await call('PATCH', 'repos/owner/demo', otherCookie, { name: 'Stolen' })).status).toBe(404);
    expect((await call('DELETE', 'repos/owner/demo', otherCookie)).status).toBe(404);
    expect((await create('DEMO')).status).toBe(409);
    expect((await create('Demo', 'PRIVATE', otherCookie)).status).toBe(201);
  });

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
    expect(publicList.repositories[0].permissions).toEqual({ canRead: true, canManage: false });
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
    expect((await publicRes.json()).repository.permissions).toEqual({ canRead: true, canManage: false });
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
    for (const query of ['', '?service=git-receive-pack', '?service=git-upload-pack&service=git-upload-pack']) expect((await fetch(`${url}/info/refs${query}`)).status).toBe(400);
    expect((await fetch(`${url}/git-receive-pack`, { method: 'POST' })).status).toBe(404);
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
      expect((await metadata.json()).repository.permissions).toEqual({ canRead: true, canManage: false });
      expect((await call('GET', 'repos/owner/demo/blob?path=private.txt', otherCookie)).status).toBe(200);
      expect((await call('PATCH', 'repos/owner/demo', otherCookie, { description: 'No' })).status).not.toBe(200);
      expect((await fetch(`${url}/git-receive-pack`, { method: 'POST', headers: { Authorization: otherAuth } })).status).toBe(404);
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
  });

  it('soft-deletes, computes configured retention and reserves the deleted name', async () => {
    expect((await call('DELETE', 'repos/owner/renamed', ownerCookie)).status).toBe(204);
    const deleted = await db.repository.findFirstOrThrow({ where: { ownerId, normalizedName: 'renamed' } });
    expect(deleted.status).toBe('DELETED');
    expect(deleted.purgeAfter!.getTime() - deleted.deletedAt!.getTime()).toBe(7 * 86400000);
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
});

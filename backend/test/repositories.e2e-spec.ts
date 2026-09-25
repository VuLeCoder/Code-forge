import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser = require('cookie-parser');

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
    await rm(bare, { recursive: true });
    const recovered = await (await call('GET', 'repos/owner/demo', ownerCookie)).json();
    expect(recovered.repository).toMatchObject({ storageState: 'RESET', storageGeneration: 1, readme: null });
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
    }
    expect((await call('PATCH', 'repos/owner/renamed', ownerCookie, { name: 'Restored' })).status).toBe(404);
    expect((await call('DELETE', 'repos/owner/renamed', ownerCookie)).status).toBe(404);
    expect((await create('RENAMED')).status).toBe(409);
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

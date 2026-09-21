import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser = require('cookie-parser');

// Each run owns a fresh schema. Never reset or truncate the development schema.
describe('Milestone 1 HTTP + PostgreSQL', () => {
  const schema = `m1_test_${randomBytes(8).toString('hex')}`;
  let admin: PrismaClient;
  let db: PrismaClient;
  let app: INestApplication;
  let origin: string;
  let url: string;
  let originalDatabaseUrl: string | undefined;
  const account = { username: 'Alice', email: 'alice@example.test', password: 'test-password-123' };
  const cookie = (response: Response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const call = (path: string, body?: unknown, cookies?: string, requestOrigin = origin) => fetch(`${url}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookies ? { Cookie: cookies } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  beforeAll(async () => {
    await ConfigModule.forRoot({ envFilePath: '.env' });
    originalDatabaseUrl = process.env.DATABASE_URL;
    if (!originalDatabaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    admin = new PrismaClient({ datasourceUrl: originalDatabaseUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(originalDatabaseUrl);
    isolatedUrl.searchParams.set('schema', schema);
    process.env.DATABASE_URL = isolatedUrl.toString();
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: isolatedUrl.toString() }, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/api/v1`;
    origin = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000').split(',')[0]!.trim();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('validates origin/input and reserves application routes', async () => {
    expect((await call('auth/login', { login: 'alice', password: account.password }, undefined, 'https://untrusted.example')).status).toBe(403);
    expect((await call('auth/register', { ...account, password: 'short' })).status).toBe(400);
    const reserved = await call('auth/register', { ...account, username: 'NeW' });
    expect(reserved.status).toBe(400);
    expect(await reserved.json()).toMatchObject({ error: { code: 'USERNAME_RESERVED' } });
  });

  it('registers, sets HttpOnly cookies, rejects normalized duplicates and exposes only public profile fields', async () => {
    const registered = await call('auth/register', account);
    expect(registered.status).toBe(201);
    const body = await registered.json();
    expect(body.user.username).toBe('Alice');
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.accessToken).toBeUndefined();
    expect(registered.headers.getSetCookie()).toHaveLength(2);
    for (const header of registered.headers.getSetCookie()) expect(header).toContain('HttpOnly');
    const stored = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'alice' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await call('auth/register', { ...account, username: 'alice', email: 'different@example.test' })).status).toBe(409);
    expect((await call('auth/register', { ...account, username: 'another-user', email: 'ALICE@example.test' })).status).toBe(409);
    expect(await db.user.count()).toBe(1);
    const profile = await call('users/ALICE');
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({ user: { username: 'Alice', createdAt: stored.createdAt.toISOString() }, repositories: [], repositoriesAvailable: false });
    expect((await call('users/missing-user')).status).toBe(404);
    expect((await call('auth/me', undefined, cookie(registered))).status).toBe(200);
    expect((await call('auth/me')).status).toBe(401);
  });

  it('logs in with email, rotates tokens, rejects reuse and revokes the family', async () => {
    expect((await call('auth/login', { login: 'alice', password: 'wrong-password' })).status).toBe(401);
    const loggedIn = await call('auth/login', { login: 'ALICE@example.test', password: account.password });
    expect(loggedIn.status).toBe(200);
    const oldCookie = cookie(loggedIn);
    const refreshed = await call('auth/refresh', {}, oldCookie);
    expect(refreshed.status).toBe(200);
    const newCookie = cookie(refreshed);
    expect(newCookie).not.toBe(oldCookie);
    expect((await call('auth/refresh', {}, oldCookie)).status).toBe(401);
    expect((await call('auth/refresh', {}, newCookie)).status).toBe(401);
  });

  it('revokes refresh on logout and rejects locked users at login, me and refresh', async () => {
    const login = () => call('auth/login', { login: 'alice', password: account.password });
    const first = cookie(await login());
    const logout = await call('auth/logout', {}, first);
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie()).toHaveLength(2);
    expect((await call('auth/refresh', {}, first)).status).toBe(401);
    expect((await call('auth/logout', {})).status).toBe(204);
    const active = cookie(await login());
    await db.user.update({ where: { normalizedUsername: 'alice' }, data: { status: 'LOCKED' } });
    const sessionsBefore = await db.session.count();
    expect((await login()).status).toBe(403);
    expect((await call('auth/refresh', {}, active)).status).toBe(403);
    expect((await call('auth/me', undefined, active)).status).toBe(401);
    expect(await db.session.count()).toBe(sessionsBefore);
    // Locking an account does not remove its public profile.
    expect((await call('users/alice')).status).toBe(200);
  });

  it('limits registration attempts', async () => {
    expect((await call('auth/register', account)).status).toBe(429);
  });

  it('enforces repository defaults, canonical ownership uniqueness and retention in PostgreSQL', async () => {
    const alice = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'alice' } });
    const bob = await db.user.create({ data: {
      username: 'Bob', normalizedUsername: 'bob', email: 'bob@example.test',
      normalizedEmail: 'bob@example.test', passwordHash: 'unused-test-fixture',
    } });
    const create = (ownerId: string, name: string, normalizedName = name.toLowerCase()) =>
      db.repository.create({ data: {
        ownerId, name, normalizedName, storageKey: randomBytes(16).toString('hex') + '.git',
      } });
    const repo = await create(alice.id, 'Demo');
    expect(repo).toMatchObject({
      visibility: 'PRIVATE', status: 'ACTIVE', defaultBranch: 'main',
      storageGeneration: 0, description: null, deletedAt: null, purgeAfter: null,
    });
    expect(repo.createdAt).toBeInstanceOf(Date);
    expect(repo.updatedAt).toBeInstanceOf(Date);
    await expect(create(alice.id, 'DEMO')).rejects.toMatchObject({ code: 'P2002' });
    await expect(create(bob.id, 'Demo')).resolves.toMatchObject({ ownerId: bob.id });
    await expect(create(alice.id, 'Demo', 'different')).rejects.toThrow();
    await expect(create('00000000-0000-0000-0000-000000000000', 'Orphan'))
      .rejects.toMatchObject({ code: 'P2003' });
    await expect(db.user.delete({ where: { id: bob.id } })).rejects.toMatchObject({ code: 'P2003' });
    await db.repository.update({ where: { id: repo.id }, data: {
      status: 'DELETED', deletedAt: new Date(), purgeAfter: new Date(Date.now() + 30 * 86400000),
    } });
    await expect(create(alice.id, 'demo')).rejects.toMatchObject({ code: 'P2002' });
    await db.repository.delete({ where: { id: repo.id } });
    await expect(create(alice.id, 'demo')).resolves.toMatchObject({ name: 'demo' });
  });
});

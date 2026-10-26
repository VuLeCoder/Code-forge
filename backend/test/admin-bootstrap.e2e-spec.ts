import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

describe('Admin bootstrap CLI + PostgreSQL', () => {
  const schema = `admin_bootstrap_${randomBytes(8).toString('hex')}`;
  let admin: PrismaClient;
  let db: PrismaClient;
  let isolatedUrl: string;
  let originalUrl: string | undefined;
  let originalUnpooledUrl: string | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL;
    originalUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
    if (!originalUrl) throw new Error('DATABASE_URL is required for integration tests');
    const target = new URL(originalUrl);
    const databaseName = decodeURIComponent(target.pathname.slice(1));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !databaseName.endsWith('_test')) {
      throw new Error('Admin bootstrap integration tests require a local PostgreSQL database whose name ends in _test.');
    }
    admin = new PrismaClient({ datasourceUrl: originalUrl });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const url = new URL(originalUrl);
    url.searchParams.set('schema', schema);
    isolatedUrl = url.toString();
    const env = { ...process.env, DATABASE_URL: isolatedUrl, DATABASE_URL_UNPOOLED: isolatedUrl };
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: process.cwd(), env, stdio: 'pipe', timeout: 30_000,
    });
    db = new PrismaClient({ datasourceUrl: isolatedUrl });
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
    if (admin) {
      if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
    if (originalUnpooledUrl) process.env.DATABASE_URL_UNPOOLED = originalUnpooledUrl;
    else delete process.env.DATABASE_URL_UNPOOLED;
  }, 30_000);

  function runBootstrap(input: string) {
    const backend = process.cwd();
    const args = ['-r', 'ts-node/register', 'src/admin/bootstrap-admin.ts'];
    return { ...spawnSync(process.execPath, args, {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: isolatedUrl, DATABASE_URL_UNPOOLED: isolatedUrl },
      input,
      encoding: 'utf8',
      timeout: 45_000,
    }), args };
  }

  it('creates an active admin with the password supplied only on stdin', async () => {
    const password = 'Admin-Password-123!';
    const result = runBootstrap(`RootAdmin\nroot-admin@example.test\n${password}\n${password}\n`);
    const safeStdout = (result.stdout ?? '').replaceAll(password, '[REDACTED]');
    const safeStderr = (result.stderr ?? '').replaceAll(password, '[REDACTED]');

    expect(result.error === undefined).toBe(true);
    expect(result.error?.message.includes(password) ?? false).toBe(false);
    expect(result.status).toBe(0);
    expect(safeStdout).toContain('Đã tạo tài khoản ADMIN RootAdmin.');
    expect(safeStderr).toBe('');
    expect(result.args.join('\0').includes(password)).toBe(false);
    expect((result.stdout ?? '').includes(password)).toBe(false);
    const user = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'rootadmin' } });
    expect(user).toMatchObject({ systemRole: 'ADMIN', status: 'ACTIVE', lockedAt: null });
    expect(user.passwordHash === password).toBe(false);
    expect(await argon2.verify(user.passwordHash, password)).toBe(true);
    await expect(db.auditLog.findMany({ where: { targetId: user.id } })).resolves.toEqual([
      expect.objectContaining({ actorId: null, action: 'SYSTEM_ADMIN_CREATED', details: { channel: 'bootstrap_cli' } }),
    ]);
  });

  it('promotes an existing account without replacing its password', async () => {
    const passwordHash = await argon2.hash('Existing-Password-123!', { type: argon2.argon2id, memoryCost: 4_096, timeCost: 1, parallelism: 1 });
    await db.user.create({ data: {
      username: 'ExistingAdmin', normalizedUsername: 'existingadmin', email: 'existing@example.test',
      normalizedEmail: 'existing@example.test', passwordHash,
    } });
    const result = runBootstrap('ExistingAdmin\nexisting@example.test\n');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Đã cấp quyền ADMIN cho ExistingAdmin; trạng thái và mật khẩu hiện tại được giữ nguyên.');
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('Password:');
    const user = await db.user.findUniqueOrThrow({ where: { normalizedUsername: 'existingadmin' } });
    expect(user.systemRole).toBe('ADMIN');
    expect(user.passwordHash).toBe(passwordHash);
    await expect(db.auditLog.findMany({ where: { targetId: user.id } })).resolves.toEqual([
      expect.objectContaining({ actorId: null, action: 'SYSTEM_ADMIN_PROMOTED', details: { channel: 'bootstrap_cli' } }),
    ]);
  });

  it('rejects a password confirmation mismatch without creating a user or audit record', async () => {
    const password = 'Admin-Password-123!';
    const confirmation = 'Admin-Password-456!';
    const auditCountBefore = await db.auditLog.count();
    const result = runBootstrap(`MismatchPassword\nmismatch-password@example.test\n${password}\n${confirmation}\n`);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(password);
    expect(result.stdout).not.toContain(confirmation);
    expect(result.stderr).toContain('Mật khẩu xác nhận không khớp.');
    expect(result.stderr).not.toContain(password);
    expect(result.stderr).not.toContain(confirmation);
    expect(result.args.join('\0')).not.toContain(password);
    expect(result.args.join('\0')).not.toContain(confirmation);
    await expect(db.user.findUnique({ where: { normalizedUsername: 'mismatchpassword' } })).resolves.toBeNull();
    await expect(db.user.findUnique({ where: { normalizedEmail: 'mismatch-password@example.test' } })).resolves.toBeNull();
    await expect(db.auditLog.count()).resolves.toBe(auditCountBefore);
  });

  it('is idempotent when the matching account already has ADMIN role', async () => {
    const passwordHash = await argon2.hash('Existing-Admin-Password-123!', { type: argon2.argon2id, memoryCost: 4_096, timeCost: 1, parallelism: 1 });
    const lockedAt = new Date('2026-10-01T00:00:00.000Z');
    const user = await db.user.create({ data: {
      username: 'AlreadyAdmin', normalizedUsername: 'alreadyadmin', email: 'already-admin@example.test',
      normalizedEmail: 'already-admin@example.test', passwordHash, systemRole: 'ADMIN', status: 'LOCKED', lockedAt,
    } });
    await db.auditLog.create({ data: {
      actorId: null, action: 'SYSTEM_ADMIN_CREATED', targetId: user.id, details: { channel: 'bootstrap_cli' },
    } });
    const auditBefore = await db.auditLog.findMany({ where: { targetId: user.id } });

    const result = runBootstrap('AlreadyAdmin\nalready-admin@example.test\n');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Tài khoản AlreadyAdmin đã có quyền ADMIN.');
    expect(result.stdout).not.toContain('Mật khẩu mới:');
    expect(result.stderr).toBe('');
    await expect(db.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      systemRole: 'ADMIN', status: 'LOCKED', lockedAt, passwordHash,
    });
    await expect(db.auditLog.findMany({ where: { targetId: user.id } })).resolves.toEqual(auditBefore);
  });

  it('does not promote an existing user when the supplied username and email do not match', async () => {
    const user = await db.user.create({ data: {
      username: 'MismatchAdmin', normalizedUsername: 'mismatchadmin', email: 'real@example.test',
      normalizedEmail: 'real@example.test', passwordHash: 'existing-hash',
    } });
    const result = runBootstrap('MismatchAdmin\nother@example.test\n');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('ADMIN');
    expect(result.stderr).toContain('Username và email không khớp với cùng một tài khoản.');
    await expect(db.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({ systemRole: 'USER' });
    await expect(db.auditLog.findMany({ where: { targetId: user.id } })).resolves.toEqual([]);
    await expect(db.user.findUnique({ where: { normalizedEmail: 'other@example.test' } })).resolves.toBeNull();
  });
});

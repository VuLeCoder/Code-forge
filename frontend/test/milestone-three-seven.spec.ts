import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const user = { id: 'user', username: 'alice', email: 'alice@example.test', systemRole: 'USER', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z' };
const token = { id: 'f28d5c51-d8bf-41e7-91b4-403ab717fdd2', name: 'Laptop', tokenPrefix: 'abc123', scopes: ['repo:read'], expiresAt: '2099-01-01T00:00:00Z', lastUsedAt: null, revokedAt: null as string | null };

test('M3.7 PAT UI creates once, copies, hides on reload, confirms revoke and fits mobile', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  let tokens: typeof token[] = [];
  await page.route('**/api/v1/tokens', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ name: 'Laptop', scopes: ['repo:read'] });
      tokens = [token];
      await route.fulfill({ status: 201, json: { token, secret: 'test-one-time-secret' } });
    } else await route.fulfill({ json: { tokens } });
  });
  let revoked = 0;
  await page.route(`**/api/v1/tokens/${token.id}`, async (route) => {
    revoked++; tokens = [{ ...token, revokedAt: new Date().toISOString() }];
    await route.fulfill({ status: 204 });
  });
  await page.goto('/settings/tokens');
  await expect(page.getByText('Chưa có token nào.')).toBeVisible();
  await page.getByLabel('Tên token').fill('Laptop');
  await page.getByRole('button', { name: 'Tạo token', exact: true }).click();
  await expect(page.getByLabel('Secret PAT')).toHaveValue('test-one-time-secret');
  await expect(page.getByLabel('Secret PAT')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Tạo token', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sao chép token' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('test-one-time-secret');
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')) }));
  await page.getByRole('button', { name: 'Sao chép token' }).click();
  await expect(page.getByRole('status')).toHaveText('Hãy sao chép token đã chọn.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('test-one-time-secret');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Laptop', exact: true })).toBeVisible();
  await expect(page.getByLabel('Secret PAT')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thu hồi Laptop', exact: true }).click();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  expect(revoked).toBe(0);
  await page.getByRole('button', { name: 'Thu hồi Laptop', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận thu hồi', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Đã thu hồi token.');
  expect(revoked).toBe(1);
});

test('M3.7 PAT guard, loading, error retry, creation failure and expiry state', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/settings/tokens');
  await expect(page).toHaveURL(/login\?returnTo=%2Fsettings%2Ftokens/);
  await page.unroute('**/api/v1/auth/*');
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/tokens', async (route) => { await pending; await route.fulfill({ status: 503, json: { error: { message: 'Tạm gián đoạn' } } }); });
  await page.goto('/settings/tokens');
  await expect(page.getByText('Đang tải token…')).toBeVisible(); release();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Tạm gián đoạn');
  await page.unroute('**/api/v1/tokens');
  await page.route('**/api/v1/tokens', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, json: { error: { message: 'Đã đạt giới hạn token' } } })
    : route.fulfill({ json: { tokens: [{ ...token, expiresAt: '2000-01-01T00:00:00Z' }] } }));
  await page.getByRole('button', { name: 'Tải lại danh sách' }).click();
  await expect(page.getByText('Đã hết hạn', { exact: false })).toBeVisible();
  await page.getByLabel('Tên token').fill('New');
  await page.getByRole('button', { name: 'Tạo token', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Đã đạt giới hạn token');
  await expect(page.getByLabel('Secret PAT')).toHaveCount(0);
});

test('M3.7 Next forwards Basic challenge and credentials without cookie; token proxy checks origin', async ({ request }) => {
  const url = 'http://localhost:3111/git/alice/private.git';
  const challenge = await request.get(`${url}/info/refs?service=git-upload-pack`);
  expect(challenge.status()).toBe(401);
  expect(challenge.headers()['www-authenticate']).toContain('Basic realm="Code Forge Git"');
  const headers = { Authorization: `Basic ${Buffer.from('alice:fixture-pat').toString('base64')}`, Cookie: 'must=not-forward' };
  expect((await request.get(`${url}/info/refs?service=git-upload-pack`, { headers })).status()).toBe(200);
  const root = await mkdtemp(join(tmpdir(), 'private-proxy-'));
  try {
    const askpass = join(root, 'askpass.sh');
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) echo alice ;; *) echo fixture-pat ;; esac\n', { mode: 0o700 });
    const git = promisify(execFile);
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    await git('git', ['-c', 'credential.helper=', 'clone', url, join(root, 'work')], { env, timeout: 20_000 });
    expect(await readFile(join(root, 'work', 'README.md'), 'utf8')).toBe('Clone through Next proxy\n');
    await git('git', ['-C', join(root, 'work'), '-c', 'credential.helper=', '-c', 'protocol.version=0', 'fetch', 'origin'], { env, timeout: 20_000 });
  } finally { await rm(root, { recursive: true, force: true }); }
  expect((await request.post('/api/v1/tokens', { headers: { Origin: 'https://evil.test' }, data: {} })).status()).toBe(403);
  const cookies = { Cookie: 'pat-test=session', Origin: 'http://localhost:3111' };
  const listed = await request.get('/api/v1/tokens', { headers: cookies });
  expect(listed.status()).toBe(200); expect(listed.headers()['cache-control']).toBe('private, no-store');
  const created = await request.post('/api/v1/tokens', { headers: cookies, data: { name: 'Proxy', scopes: ['repo:read'] } });
  expect(created.status()).toBe(201); expect(created.headers()['cache-control']).toBe('private, no-store');
  expect(await created.json()).toMatchObject({ token: { name: 'Proxy' }, secret: 'fixture-only-secret' });
  expect((await request.delete(`/api/v1/tokens/${token.id}`, { headers: cookies })).status()).toBe(204);
});

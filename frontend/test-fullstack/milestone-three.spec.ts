import { expect, test, type APIRequestContext } from '@playwright/test';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PrismaClient as Database } from '../../backend/test/fullstack-types';

const origin = 'http://localhost:3112';
test.describe.configure({ mode: 'serial' });
const password = 'm38-test-password-only';
const run = promisify(execFile);
const requireBackend = createRequire(resolve('../backend/package.json'));
const { PrismaClient } = requireBackend('@prisma/client') as typeof import('../../backend/test/fullstack-types');
let db: Database;
let state: { databaseUrl: string; root: string; logPath: string };
test.beforeAll(async () => {
  state = JSON.parse(await readFile(process.env.M38_TEST_STATE!, 'utf8'));
  db = new PrismaClient({ datasourceUrl: state.databaseUrl });
});
test.afterAll(async () => { await db?.$disconnect(); });

const mutation = (request: APIRequestContext, path: string, data: unknown) => request.post(`/api/v1/${path}`, { headers: { Origin: origin }, data });
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const git = (args: string[], env = gitEnv) => run('git', ['-c', 'credential.helper=', ...args], { env, timeout: 20_000 });
function seed(bare: string) {
  const local = (args: string[], input?: string | Buffer) => execFileSync('git', ['--git-dir', bare, ...args], { input, encoding: 'utf8', env: gitEnv }).trim();
  const blob = (content: string | Buffer) => local(['hash-object', '-w', '--stdin'], content);
  const docs = local(['mktree'], `100644 blob ${blob('hello ü\n<script>window.m38xss=true</script>\n')}\tcode ü.txt\n`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64');
  const tree = local(['mktree'], [
    `100644 blob ${blob('# Acceptance source\n\n[Code](docs/code%20%C3%BC.txt)\n\n![Pixel](pixel.png)\n\n<script>window.m38xss=true</script>\n') }\tREADME.md`,
    `040000 tree ${docs}\tdocs`, `100644 blob ${blob(png)}\tpixel.png`,
    `100644 blob ${blob(Buffer.from([0, 1, 2]))}\tbinary.bin`,
    `100644 blob ${blob(Buffer.alloc(1048577, 97))}\tlarge.txt`,
    `100644 blob ${blob('line\n'.repeat(2100))}\ttruncated.txt`,
  ].join('\n') + '\n');
  let head = local(['rev-parse', 'HEAD']);
  for (let i = 1; i <= 22; i++) head = local(['-c', 'user.name=Acceptance', '-c', 'user.email=acceptance@example.test', 'commit-tree', tree, '-p', head, '-m', `Acceptance commit ${i}`]);
  local(['update-ref', 'refs/heads/feature/demo', head]);
  return head;
}

test('M3.8 real registration, source browser desktop/mobile, history and public CLI', async ({ page, context, browser }, testInfo) => {
  await page.goto('/register?returnTo=%2Fnew');
  await page.getByLabel('Username', { exact: true }).fill('M38Owner');
  await page.getByLabel('Email', { exact: true }).fill('m38owner@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/new`);
  await page.getByRole('textbox', { name: 'Tên repository' }).fill('Source');
  await page.getByRole('checkbox', { name: /Thêm README/ }).check();
  await page.getByRole('button', { name: 'Tạo repository', exact: true }).click();
  await expect(page.getByRole('region', { name: 'README', exact: true }).getByRole('heading', { name: 'Source' })).toBeVisible();
  const repo = await db.repository.findFirstOrThrow({ where: { normalizedName: 'source' } });
  const bare = join(state.root, 'git', repo.storageKey);
  const head = seed(bare);
  const anonymous = await browser.newContext();
  const publicPage = await anonymous.newPage();
  try {
    for (const width of [1440, 375]) {
      await publicPage.setViewportSize({ width, height: 900 });
      await publicPage.goto(`${origin}/M38Owner/Source?ref=feature%2Fdemo`);
      const readme = publicPage.getByRole('region', { name: 'README', exact: true });
      await expect(readme.getByRole('heading', { name: 'Acceptance source' })).toBeVisible();
      await expect(readme.getByRole('img', { name: 'Pixel' })).toHaveAttribute('src', /^data:image\/png/);
      expect(await publicPage.evaluate(() => 'm38xss' in window)).toBe(false);
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await publicPage.screenshot({ path: testInfo.outputPath(`source-${width}.png`), fullPage: true });
      await readme.getByRole('link', { name: 'Code', exact: true }).click();
      const viewer = publicPage.getByRole('region', { name: 'Nội dung file', exact: true });
      await expect(viewer.getByText('hello ü', { exact: true })).toBeVisible();
      await expect(viewer.getByRole('rowheader', { name: '2', exact: true })).toBeVisible();
      await publicPage.reload();
      await expect(viewer.getByText('hello ü', { exact: true })).toBeVisible();
      expect(await publicPage.evaluate(() => 'm38xss' in window)).toBe(false);
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await viewer.getByRole('link', { name: '← Thư mục cha' }).click();
      await expect(publicPage.getByRole('link', { name: 'code ü.txt', exact: true })).toBeVisible();
      await publicPage.getByLabel('Branch', { exact: true }).selectOption('main');
      await expect(publicPage).toHaveURL(/\?ref=main$/);
      await expect(publicPage.getByRole('region', { name: 'README', exact: true }).getByRole('heading', { name: 'Source' })).toBeVisible();
    }
    for (const [path, message] of [['binary.bin', 'File nhị phân'], ['large.txt', 'File vượt giới hạn'], ['truncated.txt', 'bản xem trước đã cắt']]) {
      await publicPage.goto(`${origin}/M38Owner/Source?ref=feature%2Fdemo&view=blob&path=${path}`);
      await expect(publicPage.getByRole('region', { name: 'Nội dung file', exact: true }).getByText(message, { exact: false })).toBeVisible();
    }
    await publicPage.goto(`${origin}/M38Owner/Source?ref=feature%2Fdemo&view=commits`);
    const history = publicPage.getByRole('region', { name: 'Lịch sử commit', exact: true });
    await expect(history.getByRole('listitem')).toHaveCount(20);
    await history.getByRole('link', { name: 'Trang sau' }).click();
    await expect(history.getByRole('listitem')).toHaveCount(3);
    await publicPage.reload();
    await expect(history.getByRole('listitem')).toHaveCount(3);
    await history.getByRole('link', { name: 'Acceptance commit 1', exact: true }).click();
    await expect(publicPage.getByRole('region', { name: 'Chi tiết commit' }).getByRole('heading', { name: 'Acceptance commit 1' })).toBeVisible();
    await publicPage.goto(`${origin}/M38Owner/Source?ref=missing`);
    await expect(publicPage.getByRole('main').getByRole('alert')).toContainText('Branch không tồn tại');
    const traversal = await anonymous.request.get(`${origin}/api/v1/repos/M38Owner/Source/blob?path=..%2Fsecret`);
    expect(traversal.status()).toBe(400);
    expect(traversal.headers()['cache-control']).toBe('private, no-store');
    const url = `${origin}/git/M38Owner/Source.git`;
    const work = join(state.root, 'public-clone');
    await git(['-c', 'protocol.version=2', 'clone', url, work]);
    await git(['-C', work, '-c', 'protocol.version=0', 'fetch', 'origin']);
    expect((await git(['-C', work, 'rev-parse', 'origin/feature/demo'])).stdout.trim()).toBe(head);
    expect(await readFile(join(work, 'README.md'), 'utf8')).toBe('# Source\n');
    expect((await anonymous.request.post(`${url}/git-receive-pack`)).status()).toBe(404);
    expect((await mutation(context.request, 'repositories', { name: 'Empty', visibility: 'PUBLIC' })).status()).toBe(201);
    await publicPage.goto(`${origin}/M38Owner/Empty`);
    await expect(publicPage.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
    await expect(publicPage.getByLabel('Branch', { exact: true })).toBeDisabled();
    await git(['clone', `${origin}/git/M38Owner/Empty.git`, join(state.root, 'empty-clone')]);
    await rm(bare, { recursive: true });
    await publicPage.goto(`${origin}/M38Owner/Source`);
    await expect(publicPage.getByText('Mã nguồn của repository demo đã bị reset.', { exact: false })).toBeVisible();
    await expect(publicPage.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
    expect((await db.repository.findUniqueOrThrow({ where: { id: repo.id } })).storageGeneration).toBe(1);
  } finally { await anonymous.close(); }
});

test('M3.8 real private PAT UI, READ/WRITE/OWNER, revocation, audit and sanitized logs', async ({ page, context, browser }) => {
  await page.goto('/login?returnTo=%2Fsettings%2Ftokens');
  await page.getByLabel('Email hoặc username').fill('M38Owner');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Token truy cập cá nhân' })).toBeVisible();
  const created = await mutation(context.request, 'repositories', { name: 'Private', visibility: 'PRIVATE', initializeReadme: true });
  expect(created.status()).toBe(201);
  const { repository } = await created.json();
  const repo = await db.repository.findUniqueOrThrow({ where: { id: repository.id } });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('Tên token').fill('Acceptance laptop');
  await page.getByRole('button', { name: 'Tạo token', exact: true }).click();
  await expect(page.getByLabel('Secret PAT')).toHaveValue(/^cfg_/);
  const secret = await page.getByLabel('Secret PAT').inputValue();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Đã lưu, đóng secret' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Acceptance laptop', exact: true })).toBeVisible();
  await expect(page.getByLabel('Secret PAT')).toHaveCount(0);
  const { tokens } = await (await context.request.get('/api/v1/tokens')).json();
  expect(JSON.stringify(tokens).includes(secret)).toBe(false);
  const token = tokens[0];
  const stored = await db.personalAccessToken.findUniqueOrThrow({ where: { id: token.id } });
  expect(stored.tokenHash === secret).toBe(false);
  const askpass = join(state.root, 'askpass.sh');
  await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n', { mode: 0o700 });
  const credentials = (username: string, pat: string) => ({ ...gitEnv, GIT_ASKPASS: askpass, TEST_GIT_USER: username, TEST_GIT_PAT: pat });
  const url = `${origin}/git/M38Owner/Private.git`;
  const work = join(state.root, 'private-clone');
  await git(['clone', url, work], credentials('M38Owner', secret));
  expect(await readFile(join(work, 'README.md'), 'utf8')).toBe('# Private\n');
  const outsider = await browser.newContext({ baseURL: origin });
  const outsiderPage = await outsider.newPage();
  let otherSecret = '';
  try {
    const register = await mutation(outsider.request, 'auth/register', { username: 'M38Reader', email: 'reader@example.test', password });
    expect(register.status()).toBe(201);
    const otherId = (await register.json()).user.id;
    const pat = await mutation(outsider.request, 'tokens', { name: 'Read', scopes: ['repo:read'], expiresAt: new Date(Date.now() + 86400000).toISOString() });
    expect(pat.status()).toBe(201);
    otherSecret = (await pat.json()).secret;
    await db.user.update({ where: { id: otherId }, data: { systemRole: 'ADMIN' } });
    await outsiderPage.goto(`${origin}/M38Owner/Private`);
    await expect(outsiderPage.getByRole('heading', { name: 'Không tìm thấy repository' })).toBeVisible();
    const privateResponse = await outsider.request.get(`${url}/info/refs?service=git-upload-pack`);
    const missingResponse = await outsider.request.get(`${origin}/git/M38Owner/Missing.git/info/refs?service=git-upload-pack`);
    expect(privateResponse.status()).toBe(401);
    expect(privateResponse.headers()['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(missingResponse.status()).toBe(401);
    expect(await privateResponse.text()).toBe(await missingResponse.text());
    const auth = { Authorization: `Basic ${Buffer.from(`M38Reader:${otherSecret}`).toString('base64')}` };
    expect((await outsider.request.get(`${url}/info/refs?service=git-upload-pack`, { headers: auth })).status()).toBe(404);
    for (const role of ['READ', 'WRITE'] as const) {
      await db.repositoryMember.upsert({ where: { repositoryId_userId: { repositoryId: repo.id, userId: otherId } }, create: { repositoryId: repo.id, userId: otherId, role }, update: { role } });
      await outsiderPage.reload();
      await expect(outsiderPage.getByRole('region', { name: 'README', exact: true }).getByRole('heading', { name: 'Private' })).toBeVisible();
      await expect(outsiderPage.getByRole('link', { name: 'Cài đặt', exact: true })).toHaveCount(0);
      await git(['clone', url, join(state.root, `member-${role}`)], credentials('M38Reader', otherSecret));
      await git(['-C', join(state.root, `member-${role}`), '-c', 'protocol.version=0', 'fetch', 'origin'], credentials('M38Reader', otherSecret));
    }
    await db.repositoryMember.delete({ where: { repositoryId_userId: { repositoryId: repo.id, userId: otherId } } });
    await outsiderPage.reload();
    await expect(outsiderPage.getByRole('heading', { name: 'Không tìm thấy repository' })).toBeVisible();
    expect((await outsider.request.get(`${url}/info/refs?service=git-upload-pack`, { headers: auth })).status()).toBe(404);
    await page.getByRole('button', { name: 'Thu hồi Acceptance laptop', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận thu hồi', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Đã thu hồi token.');
    await expect(git(['-C', work, 'fetch', 'origin'], credentials('M38Owner', secret))).rejects.toThrow();
    const audit = await db.auditLog.findMany({ where: { targetId: token.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((entry) => entry.action)).toEqual(['TOKEN_CREATED', 'TOKEN_REVOKED']);
    expect(audit.every((entry) => entry.actorId === repo.ownerId)).toBe(true);
    expect(JSON.stringify(audit).includes(secret)).toBe(false);
    const logs = await readFile(state.logPath, 'utf8');
    for (const sensitive of [secret, otherSecret, password, '# Private', stored.tokenHash]) expect(logs.includes(sensitive)).toBe(false);
    const events = [...logs.matchAll(/\{"event":"git_read"[^\n]*?\}/g)].map(([json]) => JSON.parse(json));
    expect(events.some((event) => event.status === 200 && event.operation === 'upload-pack')).toBe(true);
    expect(events.some((event) => event.status === 401)).toBe(true);
    expect(events.some((event) => event.status === 404)).toBe(true);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['event', 'requestId', 'operation', 'status', 'outcome', 'durationMs', 'activeProcesses'].sort());
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  } finally { await outsider.close(); }
});

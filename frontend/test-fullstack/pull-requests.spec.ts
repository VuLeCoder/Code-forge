import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PrismaClient as Database } from '../../backend/test/fullstack-types';

const origin = 'http://localhost:3112';
const password = 'mvp-pr-journey-password-1';
const run = promisify(execFile);
const requireBackend = createRequire(resolve('../backend/package.json'));
const { PrismaClient } = requireBackend('@prisma/client') as typeof import('../../backend/test/fullstack-types');
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const git = (args: string[], env = gitEnv) => run('git', ['-c', 'credential.helper=', ...args], { env, timeout: 30_000 });
const mutation = (request: APIRequestContext, path: string, data: unknown) =>
  request.post(`/api/v1/${path}`, { headers: { Origin: origin }, data });

test.describe.configure({ mode: 'serial' });

let db: Database;
let state: { databaseUrl: string; root: string; logPath: string };

test.beforeAll(async () => {
  const path = process.env.M38_TEST_STATE;
  if (!path) throw new Error('M38_TEST_STATE is missing; run through playwright.fullstack.config.ts setup.');
  state = JSON.parse(await readFile(path, 'utf8')) as typeof state;
  db = new PrismaClient({ datasourceUrl: state.databaseUrl });
});

test.afterAll(async () => { await db?.$disconnect(); });

test('WRITE collaborator accepts invite, pushes a feature branch, and owner merges its PR', async ({ page, browser, context }) => {
  const suffix = randomBytes(4).toString('hex');
  const ownerName = `MvpOwner${suffix}`;
  const collaboratorName = `MvpWriter${suffix}`;
  const repositoryName = `PullFlow${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}@example.test`;

  await page.goto('/register?returnTo=%2F');
  await page.getByLabel('Username', { exact: true }).fill(ownerName);
  await page.getByLabel('Email', { exact: true }).fill(email(ownerName));
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);

  const createdRepository = await mutation(context.request, 'repositories', {
    name: repositoryName, visibility: 'PRIVATE', initializeReadme: true,
  });
  expect(createdRepository.status()).toBe(201);
  const repositoryId = (await createdRepository.json()).repository.id as string;
  expect(await db.repository.findUnique({ where: { id: repositoryId } })).not.toBeNull();

  const collaboratorContext = await browser.newContext({ baseURL: origin });
  const collaboratorPage = await collaboratorContext.newPage();
  try {
    await collaboratorPage.goto('/register?returnTo=%2Finvitations');
    await collaboratorPage.getByLabel('Username', { exact: true }).fill(collaboratorName);
    await collaboratorPage.getByLabel('Email', { exact: true }).fill(email(collaboratorName));
    await collaboratorPage.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await collaboratorPage.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password);
    await collaboratorPage.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(collaboratorPage).toHaveURL(`${origin}/invitations`);

    const invite = await mutation(context.request, `repos/${ownerName}/${repositoryName}/invitations`, {
      username: collaboratorName, role: 'WRITE',
    });
    expect(invite.status()).toBe(201);
    await collaboratorPage.reload();
    await collaboratorPage.getByRole('button', {
      name: `Chấp nhận lời mời vào ${ownerName}/${repositoryName}`,
    }).click();
    await expect(collaboratorPage.getByRole('status')).toContainText('Ghi (WRITE)');

    const tokenResponse = await mutation(collaboratorContext.request, 'tokens', {
      name: 'Full-stack PR test', scopes: ['repo:read', 'repo:write'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(tokenResponse.status()).toBe(201);
    const { secret } = await tokenResponse.json() as { secret: string };
    expect(secret).toMatch(/^cfg_[a-f0-9]{16}_[a-f0-9]{64}$/);

    const askpass = join(state.root, `askpass-${suffix}.sh`);
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n',
      { mode: 0o700 },
    );
    const credentials = { ...gitEnv, GIT_ASKPASS: askpass, TEST_GIT_USER: collaboratorName, TEST_GIT_PAT: secret };
    const gitUrl = `${origin}/git/${ownerName}/${repositoryName}.git`;
    const work = join(state.root, `pr-writer-${suffix}`);
    await git(['clone', gitUrl, work], credentials);
    await git(['-C', work, 'config', 'user.name', 'Full-stack Writer']);
    await git(['-C', work, 'config', 'user.email', email(collaboratorName)]);
    await git(['-C', work, 'checkout', '-b', 'feature/pull-flow'], credentials);
    await writeFile(join(work, 'collaborator-change.txt'), 'Change pushed by the WRITE collaborator.\n');
    await git(['-C', work, 'add', 'collaborator-change.txt']);
    await git(['-C', work, 'commit', '-m', 'Add collaborator change']);
    const sourceSha = (await git(['-C', work, 'rev-parse', 'HEAD'])).stdout.trim();
    await git(['-C', work, 'push', '-u', 'origin', 'HEAD:refs/heads/feature/pull-flow'], credentials);

    await collaboratorPage.goto(`/${ownerName}/${repositoryName}/pulls`);
    const createPullRequest = collaboratorPage.getByRole('button', { name: 'Tạo pull request', exact: true }).first();
    await expect(createPullRequest, 'Collaborator can create PR and the same-origin API returned its permissions.').toBeVisible({ timeout: 15_000 });
    await createPullRequest.click();
    await collaboratorPage.getByLabel('Tiêu đề').fill('Review collaborator change');
    await collaboratorPage.getByLabel('Branch nguồn').selectOption('feature/pull-flow');
    await collaboratorPage.getByLabel('Mô tả').fill('A complete owner and collaborator flow.');
    await collaboratorPage.getByRole('button', { name: 'Tạo pull request', exact: true }).last().click();
    await expect(collaboratorPage.getByRole('heading', { name: /Review collaborator change/ })).toBeVisible();

    await page.goto(`/${ownerName}/${repositoryName}/pulls`);
    await page.getByRole('link', { name: /Review collaborator change/ }).click();
    await expect(page.getByRole('heading', { name: /Review collaborator change/ })).toBeVisible();
    await expect(page.getByText('feature/pull-flow', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel('Diff của collaborator-change.txt')).toContainText('Change pushed by the WRITE collaborator.');
    await expect(page.getByRole('region', { name: /Files changed/ })
      .getByText('collaborator-change.txt', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Merge pull request' }).click();
    await page.getByRole('button', { name: 'Xác nhận merge' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Đã merge/ })).toBeVisible({ timeout: 15_000 });

    await git(['-C', work, 'fetch', 'origin', 'main'], credentials);
    const fetchedSha = (await git(['-C', work, 'rev-parse', 'FETCH_HEAD'])).stdout.trim();
    const parents = (await git(['-C', work, 'rev-list', '--parents', '-n', '1', 'FETCH_HEAD'])).stdout.trim().split(/\s+/);
    expect(fetchedSha).not.toBe(sourceSha);
    expect(parents).toHaveLength(3);
    expect(parents).toContain(sourceSha);
    expect(await readFile(join(work, 'collaborator-change.txt'), 'utf8')).toBe('Change pushed by the WRITE collaborator.\n');
  } finally {
    await collaboratorContext.close();
  }
});

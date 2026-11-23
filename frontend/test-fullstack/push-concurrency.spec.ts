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
const { hash, argon2id } = requireBackend('argon2') as Pick<typeof import('../../backend/test/fullstack-types'), 'hash' | 'argon2id'>;
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const git = (args: string[], env: NodeJS.ProcessEnv = gitEnv) => run('git', ['-c', 'credential.helper=', ...args], { env, timeout: 30_000 });
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

test('two authenticated writers racing on one branch preserve the winning commit and recover by rebase', async ({ browser }) => {
  const suffix = randomBytes(4).toString('hex');
  const names = [`RaceOwner${suffix}`, `RaceWriter${suffix}`];
  const contexts = await Promise.all(names.map(() => browser.newContext({ baseURL: origin })));
  try {
    // Registration is covered by other journeys. Seed only this isolated test's
    // users so the combined suite respects the registration rate limit.
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    for (let i = 0; i < 2; i++) {
      const username = names[i]!;
      const email = `${username}@example.test`;
      await db.user.create({ data: {
        username, normalizedUsername: username.toLowerCase(),
        email, normalizedEmail: email.toLowerCase(), passwordHash,
      } });
      const loggedIn = await mutation(contexts[i]!.request, 'auth/login', {
        login: username, password,
      });
      expect(loggedIn.status()).toBe(200);
    }
    const repo = `Race${suffix}`;
    expect((await mutation(contexts[0]!.request, 'repositories', {
      name: repo, visibility: 'PRIVATE', initializeReadme: true,
    })).status()).toBe(201);
    const invite = await mutation(contexts[0]!.request, `repos/${names[0]}/${repo}/invitations`, {
      username: names[1], role: 'WRITE',
    });
    expect(invite.status()).toBe(201);
    const invitation = await invite.json();
    expect((await mutation(contexts[1]!.request, `invitations/${invitation.invitation.id}/accept`, {})).ok()).toBeTruthy();
    const askpass = join(state.root, `race-askpass-${suffix}.sh`);
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$TEST_GIT_USER" ;; *) printf "%s\\n" "$TEST_GIT_PAT" ;; esac\n', { mode: 0o700 });
    const credentials: NodeJS.ProcessEnv[] = [];
    const works = names.map((_, i) => join(state.root, `race-${suffix}-${i}`));
    const shas = [];
    for (let i = 0; i < 2; i++) {
      const token = await mutation(contexts[i]!.request, 'tokens', {
        name: 'Race test', scopes: ['repo:read', 'repo:write'],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(token.status()).toBe(201);
      credentials.push({ ...gitEnv, GIT_ASKPASS: askpass, TEST_GIT_USER: names[i]!, TEST_GIT_PAT: (await token.json()).secret as string });
      await git(['clone', `${origin}/git/${names[0]}/${repo}.git`, works[i]!], credentials[i]);
      await git(['-C', works[i]!, 'config', 'user.name', names[i]!]);
      await git(['-C', works[i]!, 'config', 'user.email', `${names[i]}@example.test`]);
      await writeFile(join(works[i]!, `writer-${i}.txt`), `Writer ${i}\n`);
      await git(['-C', works[i]!, 'add', '.']);
      await git(['-C', works[i]!, 'commit', '-m', `Writer ${i}`]);
      shas.push((await git(['-C', works[i]!, 'rev-parse', 'HEAD'])).stdout.trim());
    }
    const protectedOutcomes = await Promise.allSettled(works.map((work, i) => git(['-C', work, 'push', 'origin', 'HEAD:main'], credentials[i])));
    expect(protectedOutcomes.every(result => result.status === 'rejected')).toBe(true);
    const settings = await contexts[0]!.request.patch(`/api/v1/repos/${names[0]}/${repo}`, {
      headers: { Origin: origin }, data: { protectDefaultBranch: false },
    });
    expect(settings.ok()).toBeTruthy();
    const outcomes = await Promise.allSettled(works.map((work, i) => git(['-C', work, 'push', 'origin', 'HEAD:main'], credentials[i])));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes.findIndex(result => result.status === 'fulfilled');
    const loser = 1 - winner;
    await git(['-C', works[loser]!, 'fetch', 'origin'], credentials[loser]);
    expect((await git(['-C', works[loser]!, 'rev-parse', 'origin/main'])).stdout.trim()).toBe(shas[winner]);
    // An unchanged retry must remain rejected; it cannot silently overwrite the winner.
    await expect(git(['-C', works[loser]!, 'push', 'origin', 'HEAD:main'], credentials[loser])).rejects.toBeDefined();
    await git(['-C', works[loser]!, 'rebase', 'origin/main']);
    await git(['-C', works[loser]!, 'push', 'origin', 'HEAD:main'], credentials[loser]);
    await git(['-C', works[winner]!, 'pull', '--ff-only'], credentials[winner]);
    for (const i of [0, 1]) expect(await readFile(join(works[winner]!, `writer-${i}.txt`), 'utf8')).toBe(`Writer ${i}\n`);
    await git(['-C', works[winner]!, 'merge-base', '--is-ancestor', shas[winner]!, 'HEAD']);
    // Both writers now edit the same line from the same base.
    for (let i = 0; i < 2; i++) {
      await git(['-C', works[i]!, 'pull', '--ff-only'], credentials[i]);
      await writeFile(join(works[i]!, 'writer-0.txt'), `Conflicting edit by writer ${i}\n`);
      await git(['-C', works[i]!, 'add', '.']);
      await git(['-C', works[i]!, 'commit', '-m', `Conflicting edit ${i}`]);
    }
    const conflicts = await Promise.allSettled(works.map((work, i) => git(['-C', work, 'push', 'origin', 'HEAD:main'], credentials[i])));
    expect(conflicts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const conflictWinner = conflicts.findIndex(result => result.status === 'fulfilled');
    const conflictLoser = 1 - conflictWinner;
    await git(['-C', works[conflictLoser]!, 'fetch', 'origin'], credentials[conflictLoser]);
    await expect(git(['-C', works[conflictLoser]!, 'rebase', 'origin/main'])).rejects.toBeDefined();
    expect((await git(['-C', works[conflictLoser]!, 'diff', '--name-only', '--diff-filter=U'])).stdout.trim()).toBe('writer-0.txt');
    const remoteSha = (await git(['-C', works[conflictLoser]!, 'rev-parse', 'origin/main'])).stdout.trim();
    expect(remoteSha).toBe((await git(['-C', works[conflictWinner]!, 'rev-parse', 'HEAD'])).stdout.trim());
    await git(['-C', works[conflictLoser]!, 'rebase', '--abort']);

  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

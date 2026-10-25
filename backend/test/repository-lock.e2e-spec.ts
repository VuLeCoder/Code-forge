import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { Request, Response } from 'express';
import { GitHttpService } from '../src/repositories/git-http.service';
import { GitStorageService } from '../src/repositories/git-storage.service';
import { RepositoryLockService, type RepositoryLock } from '../src/repositories/repository-lock.service';

const requireFromBackend = createRequire(__filename);

function assertIsolatedDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !databaseName.endsWith('_test')) {
    throw new Error('Repository lock E2E requires a loopback PostgreSQL database whose name ends in _test.');
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${description} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function failCleanup(error: unknown): Promise<never> {
  return Promise.reject(error instanceof Error ? error : new Error(String(error)));
}

async function waitForChildReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  await withTimeout(new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.includes('LOCKED\n')) resolve();
    });
    child.once('error', () => reject(new Error('Could not start the child lock process.')));
    child.once('exit', (code) => reject(new Error(`Child lock process exited before acquiring its lock (${code}).`)));
  }), 5_000, 'Child lock process startup');
}

async function waitForBlockedService(client: Client, applicationName: string): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE application_name = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'
       ) AS blocked`,
      [applicationName],
    );
    if (result.rows[0]?.blocked) return true;
    await delay(25);
  }
  return false;
}

async function stopChild(child: ChildProcessWithoutNullStreams, detachedProcessGroup = false): Promise<void> {
  const alreadyExited = child.exitCode !== null || child.signalCode !== null;
  if (!alreadyExited) {
    try {
      child.stdin.write('release\n');
      child.stdin.end();
    } catch { /* A closed stdin must not prevent bounded process termination. */ }
  }
  if (detachedProcessGroup && child.pid && process.platform !== 'win32') {
    // The detached group may outlive its direct child (for example, a blocked Git hook).
    // Probe the group first so an already-reused PID is never signalled after all test children exit.
    try {
      process.kill(-child.pid, 0);
      process.kill(-child.pid, 'SIGKILL');
    } catch { /* The group may already have exited; the child PID fallback below is bounded. */ }
  }
  if (alreadyExited) return;
  const closed = once(child, 'close').then(() => true);
  const timeout = new AbortController();
  let exited: boolean;
  try {
    exited = await Promise.race([
      closed,
      delay(2_000, undefined, { signal: timeout.signal }).then(() => false),
    ]);
  } finally {
    timeout.abort();
  }
  if (exited) return;
  if (!child.kill('SIGKILL')) {
    // A false return can mean the child exited between the state check and signal.
  }
  await withTimeout(closed, 2_000, 'Child lock process shutdown');
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      // A zombie has exited; its parent/init has not reaped the PID yet.
      if (!state || state.startsWith('Z')) return;
    }
    catch (error) {
      if ((error as { status?: number }).status === 1) return;
      throw error;
    }
    await delay(25);
  }
  throw new Error(`Hook process ${pid} remained alive after process-group cancellation.`);
}

function pktLine(payload: Buffer): Buffer {
  const length = Buffer.from((payload.length + 4).toString(16).padStart(4, '0'));
  return Buffer.concat([length, payload]);
}

describe('RepositoryLockService PostgreSQL advisory lock', () => {
  it('serializes lock acquisition across independent Node processes', async () => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required for repository lock E2E tests.');
    assertIsolatedDatabase(connectionString);

    const lockKey = randomUUID();
    const parentApplicationName = `repo-lock-parent-${lockKey}`;
    const childConnection = new URL(connectionString);
    childConnection.searchParams.set('application_name', `repo-lock-child-${lockKey}`);
    const parentConnection = new URL(connectionString);
    parentConnection.searchParams.set('application_name', parentApplicationName);
    const monitor = new Client({ connectionString });
    const config = { getOrThrow: () => parentConnection.toString() } as unknown as ConfigService;
    const locks = new RepositoryLockService(config);
    let child: ChildProcessWithoutNullStreams | undefined;
    let parentLock: RepositoryLock | undefined;
    let acquisition: Promise<RepositoryLock> | undefined;

    try {
      await monitor.connect();
      const childScript = `
        const { Client } = require(process.env.PG_MODULE_PATH);
        const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
        (async () => {
          await client.connect();
          await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [process.env.TEST_LOCK_KEY]);
          process.stdout.write('LOCKED\\n');
          await new Promise((resolve) => process.stdin.once('data', resolve));
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [process.env.TEST_LOCK_KEY]);
          await client.end();
        })().catch(async () => {
          try { await client.end(); } catch {}
          process.exitCode = 1;
        });
      `;
      child = spawn(process.execPath, ['-e', childScript], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL_UNPOOLED: childConnection.toString(),
          PG_MODULE_PATH: requireFromBackend.resolve('pg'),
          TEST_LOCK_KEY: lockKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      await waitForChildReady(child);

      acquisition = locks.acquire(lockKey);
      const blocked = await waitForBlockedService(monitor, parentApplicationName);
      expect(blocked).toBe(true);

      await stopChild(child);
      parentLock = await withTimeout(acquisition, 5_000, 'Parent advisory lock acquisition');
      expect(parentLock.signal.aborted).toBe(false);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) await stopChild(child);
      if (acquisition && !parentLock) {
        try { parentLock = await withTimeout(acquisition, 5_000, 'Pending parent advisory lock cleanup'); }
        catch { /* The child failed before the parent could acquire the lock. */ }
      }
      await parentLock?.release();
      await locks.onModuleDestroy();
      await monitor.end();
    }
  }, 20_000);

  it('cancels receive-pack waiting for pack input when only its lock connection is terminated', async () => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required for repository lock E2E tests.');
    assertIsolatedDatabase(connectionString);

    const lockKey = randomUUID();
    const applicationName = `repo-lock-loss-${lockKey}`;
    const lockConnection = new URL(connectionString);
    lockConnection.searchParams.set('application_name', applicationName);
    const monitor = new Client({ connectionString });
    const gitRoot = await mkdtemp(join(tmpdir(), 'code-forge-lock-loss-'));
    const repositoryPath = join(gitRoot, `${lockKey}.git`);
    const config = { getOrThrow: (key: string) => key === 'DATABASE_URL_UNPOOLED'
      ? lockConnection.toString()
      : key === 'GIT_STORAGE_PATH' ? gitRoot
        : key === 'MAX_FILE_BYTES' ? 1024 * 1024
          : key === 'MAX_REPOSITORY_BYTES' ? 10 * 1024 * 1024 : undefined } as unknown as ConfigService;
    const locks = new RepositoryLockService(config);
    let child: ChildProcessWithoutNullStreams | undefined;
    let poolEnded = false;
    let service: GitHttpService | undefined;
    let requestStream: PassThrough | undefined;
    let responseStream: PassThrough | undefined;
    let childClosed: Promise<unknown> | undefined;

    try {
      execFileSync('git', ['init', '--bare', repositoryPath], { stdio: 'ignore' });
      const tree = execFileSync('git', ['--git-dir', repositoryPath, 'mktree'], { input: '', encoding: 'utf8' }).trim();
      const oldSha = execFileSync('git', ['-c', 'user.name=Repository Lock Test', '-c', 'user.email=repository-lock@example.test',
        '--git-dir', repositoryPath, 'commit-tree', tree, '-m', 'old'], { encoding: 'utf8' }).trim();
      execFileSync('git', ['--git-dir', repositoryPath, 'update-ref', 'refs/heads/main', oldSha]);

      await monitor.connect();
      const storage = new GitStorageService(config);
      const openPack = storage.openPack.bind(storage);
      jest.spyOn(storage, 'openPack').mockImplementation((...args) => {
        child = openPack(...args);
        childClosed = once(child, 'close');
        return child;
      });
      const repositories = {
        prepareGit: () => Promise.resolve({ storageKey: `${lockKey}.git`, defaultBranch: 'main', repositoryId: lockKey,
          actorIsOwner: true, operation: 'write' as const, storageGeneration: 1, userId: randomUUID() }),
        recheckGit: () => Promise.resolve({ storageKey: `${lockKey}.git`, defaultBranch: 'main', repositoryId: lockKey,
          actorIsOwner: true, operation: 'write' as const, storageGeneration: 1, userId: randomUUID() }),
      };
      const pushJournal = {
        begin: () => Promise.resolve({ operationId: randomUUID() }),
        recordChildSuccess: () => Promise.resolve(true),
        finish: () => Promise.resolve(true),
        fail: () => Promise.resolve(undefined),
        markChildFailed: () => Promise.resolve(undefined),
        markNeedsReconciliation: () => Promise.resolve(undefined),
      };
      service = new GitHttpService(repositories as never, storage, config, locks, pushJournal as never);
      const requestInput = Object.assign(new PassThrough(), {
        query: {},
        headers: { 'content-type': 'application/x-git-receive-pack-request', 'content-length': '1' },
        aborted: false,
      });
      requestStream = requestInput;
      const request = requestInput as unknown as Request;
      const responseOutput = new PassThrough();
      responseStream = responseOutput;
      const responseHeaders = new Map<string, string>();
      const response = Object.assign(responseOutput, {
        statusCode: 200,
        headersSent: false,
        setHeader: (name: string, value: string) => { responseHeaders.set(name, value); return responseOutput; },
        status: (code: number) => { (responseOutput as unknown as { statusCode: number }).statusCode = code; return responseOutput; },
        type: (value: string) => { responseHeaders.set('Content-Type', value); return responseOutput; },
      }) as unknown as Response;
      responseOutput.resume();
      const serving = service.serve('alice', 'lock-loss.git', 'git-receive-pack', request, response);
      // Deliberately leave the request open without sending pack bytes: this covers pre-input cancellation only.
      await withTimeout(new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5_000;
        const check = () => {
          if (child?.pid && child.exitCode === null && child.signalCode === null) return resolve();
          if (child && (child.exitCode !== null || child.signalCode !== null)) return reject(new Error('Git push process exited before lock loss.'));
          if (Date.now() >= deadline) return reject(new Error('Git push process did not start.'));
          setTimeout(check, 10);
        };
        check();
      }), 5_000, 'Git push process startup');
      await serving;
      const runningChild = child;
      if (!runningChild) throw new Error('Git push process was not captured.');
      childClosed ??= once(runningChild, 'close');
      const lockPidResult = await monitor.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE application_name = $1", [applicationName],
      );
      const lockPid = lockPidResult.rows[0]?.pid;
      if (!lockPid) throw new Error('The lock-owning PostgreSQL connection did not expose its backend PID.');

      // This terminates exactly the backend connection that owns the advisory lock.
      const terminated = await monitor.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated', [lockPid],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      await withTimeout(childClosed, 5_000, 'Git ref update cancellation');
      expect(runningChild.signalCode).toBe('SIGKILL');
      expect(response.statusCode).toBe(503);

      // No pack bytes were sent, so this only checks pre-input cancellation and unchanged repository state.
      // It does not prove cancellation/ref safety once receive-pack is processing a valid push.
      const actualSha = execFileSync('git', ['--git-dir', repositoryPath, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
      expect(actualSha).toBe(oldSha);

      await withTimeout(new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5_000;
        const check = async () => {
          try {
            const result = await monitor.query<{ count: string }>(
              'SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1', [applicationName],
            );
            if (result.rows[0]?.count === '0') return resolve();
          } catch (error) { return reject(error instanceof Error ? error : new Error(String(error))); }
          if (Date.now() >= deadline) return reject(new Error('Repository lock pool connection was not released.'));
          setTimeout(() => { void check(); }, 25);
        };
        void check();
      }), 5_000, 'Repository lock pool release');
      service.onModuleDestroy();
      service = undefined;
      await locks.onModuleDestroy();
      poolEnded = true;
    } finally {
      const cleanupChildClosed = child ? childClosed ?? once(child, 'close') : undefined;
      requestStream?.destroy();
      responseStream?.destroy();
      let childClosedConfirmed = !child;
      let cleanupFailure: unknown;
      try {
        if (cleanupChildClosed) {
          try {
            await withTimeout(cleanupChildClosed, 5_000, 'Git push process cleanup');
            childClosedConfirmed = true;
          } catch (initialCloseError) {
            try {
              if (child?.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
              else child?.kill('SIGKILL');
            } catch { /* Process may have exited between the check and signal. */ }
            try {
              await withTimeout(cleanupChildClosed, 2_000, 'Git push process forced cleanup');
              childClosedConfirmed = true;
            } catch (forcedCloseError) {
              cleanupFailure = new Error(
                `Git push process did not close; preserving test storage at ${gitRoot}.`,
                { cause: forcedCloseError ?? initialCloseError },
              );
            }
          }
        }
      } finally {
        try {
          try { service?.onModuleDestroy(); }
          catch (error) { cleanupFailure ??= error; }
          if (!poolEnded) {
            try {
              await locks.onModuleDestroy();
              poolEnded = true;
            } catch (error) { cleanupFailure ??= error; }
          }
        } finally {
          try {
            if (monitor) {
              try { await monitor.end(); }
              catch (error) { cleanupFailure ??= error; }
            }
          } finally {
            if (childClosedConfirmed) {
              try { await rm(gitRoot, { recursive: true, force: true }); }
              catch (error) { cleanupFailure ??= error; }
            }
          }
        }
      }
      if (cleanupFailure) await failCleanup(cleanupFailure);
    }
  }, 20_000);

  // GitHttpService kills the detached process group on POSIX; Windows child.kill()
  // cannot reliably terminate the nested hook process used as this barrier.
  const activePushTest = process.platform === 'win32' ? it.skip : it;
  activePushTest('cancels a valid receive-pack after pre-receive begins when its lock connection is terminated', async () => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required for repository lock E2E tests.');
    assertIsolatedDatabase(connectionString);

    const lockKey = randomUUID();
    const applicationName = `repo-lock-valid-pack-${lockKey}`;
    const lockConnection = new URL(connectionString);
    lockConnection.searchParams.set('application_name', applicationName);
    const monitor = new Client({ connectionString });
    const gitRoot = await mkdtemp(join(tmpdir(), 'code-forge-lock-valid-pack-'));
    const repositoryPath = join(gitRoot, `${lockKey}.git`);
    const clientPath = join(gitRoot, 'client');
    const hookRoot = join(gitRoot, 'hooks');
    const hookStarted = join(gitRoot, 'pre-receive-started');
    const hookRelease = join(gitRoot, 'pre-receive-release');
    const config = { getOrThrow: (key: string) => key === 'DATABASE_URL_UNPOOLED'
      ? lockConnection.toString()
      : key === 'GIT_STORAGE_PATH' ? gitRoot
        : key === 'MAX_FILE_BYTES' ? 1024 * 1024
          : key === 'MAX_REPOSITORY_BYTES' ? 10 * 1024 * 1024
            : key === 'MAX_PUSH_BYTES' ? 10 * 1024 * 1024 : undefined } as unknown as ConfigService;
    const locks = new RepositoryLockService(config);
    let child: ChildProcessWithoutNullStreams | undefined;
    let childClosed: Promise<unknown> | undefined;
    let poolEnded = false;
    let service: GitHttpService | undefined;

    try {
      const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
      execFileSync('git', ['init', '--bare', repositoryPath], { stdio: 'ignore', env: gitEnv });
      const tree = execFileSync('git', ['--git-dir', repositoryPath, 'mktree'], { input: '', encoding: 'utf8', env: gitEnv }).trim();
      const oldSha = execFileSync('git', ['-c', 'user.name=Repository Lock Test', '-c', 'user.email=repository-lock@example.test',
        '--git-dir', repositoryPath, 'commit-tree', tree, '-m', 'old'], { encoding: 'utf8', env: gitEnv }).trim();
      execFileSync('git', ['--git-dir', repositoryPath, 'update-ref', 'refs/heads/main', oldSha], { env: gitEnv });
      execFileSync('git', ['--git-dir', repositoryPath, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { env: gitEnv });
      execFileSync('git', ['clone', '--quiet', repositoryPath, clientPath], { stdio: 'ignore', env: gitEnv });
      await writeFile(join(clientPath, 'payload.txt'), `valid pack ${lockKey}\n`);
      execFileSync('git', ['-C', clientPath, 'add', 'payload.txt'], { stdio: 'ignore', env: gitEnv });
      execFileSync('git', ['-c', 'user.name=Repository Lock Test', '-c', 'user.email=repository-lock@example.test',
        '-C', clientPath, 'commit', '--quiet', '-m', 'valid push'], { stdio: 'ignore', env: gitEnv });
      const newSha = execFileSync('git', ['-C', clientPath, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: gitEnv }).trim();
      const pack = execFileSync('git', ['-C', clientPath, 'pack-objects', '--stdout', '--revs'], {
        input: `${newSha}\n^${oldSha}\n`, env: gitEnv, maxBuffer: 10 * 1024 * 1024,
      });
      expect(pack.subarray(0, 4).toString('ascii')).toBe('PACK');
      const featureRef = 'refs/heads/feature/lock-loss';
      const absentRefSha = '0'.repeat(oldSha.length);
      const command = Buffer.from(`${absentRefSha} ${newSha} ${featureRef}\0report-status\n`);
      const body = Buffer.concat([pktLine(command), Buffer.from('0000'), pack]);

      await mkdir(hookRoot, { recursive: true });
      const realHook = requireFromBackend.resolve('../src/repositories/pre-receive-hook.cjs');
      const barrierHook = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const refs = fs.readFileSync(0);
fs.writeFileSync(process.env.CODE_FORGE_TEST_HOOK_STARTED, JSON.stringify({ pid: process.pid, refs: refs.toString('utf8') }));
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

      await monitor.connect();
      const storage = new GitStorageService(config);
      // Match GitStorageService.openPack arguments, changing only hooksPath so this test can
      // deterministically pause after Git has accepted/unpacked the pack and before ref updates.
      jest.spyOn(storage, 'openPack').mockImplementation((key, defaultBranch, gitService, advertise, protocol, actorIsOwner) => {
        child = spawn('git', [
          '-c', `http.receivepack=${gitService === 'git-receive-pack'}`,
          '-c', 'http.getanyfile=false', '-c', `http.uploadpack=${gitService !== 'git-receive-pack'}`,
          '-c', 'http.maxRequestBuffer=1048576', '-c', `core.hooksPath=${hookRoot}`,
          ...(gitService === 'git-receive-pack' ? ['-c', 'receive.denyNonFastForwards=true'] : []),
          'http-backend',
        ], {
          detached: true,
          env: {
            PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_PROJECT_ROOT: gitRoot, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: `/${key}/${advertise ? 'info/refs' : gitService}`,
            REQUEST_METHOD: advertise ? 'GET' : 'POST', QUERY_STRING: advertise ? `service=${gitService}` : '',
            CONTENT_TYPE: advertise ? '' : `application/x-${gitService}-request`,
            ...(gitService === 'git-receive-pack' ? {
              CODE_FORGE_DEFAULT_BRANCH: defaultBranch,
              CODE_FORGE_ALLOW_DEFAULT_BRANCH_INITIALIZATION: String(actorIsOwner),
              CODE_FORGE_MAX_FILE_BYTES: String(1024 * 1024),
              CODE_FORGE_MAX_REPOSITORY_BYTES: String(10 * 1024 * 1024),
              CODE_FORGE_TEST_HOOK_STARTED: hookStarted,
              CODE_FORGE_TEST_HOOK_RELEASE: hookRelease,
              CODE_FORGE_TEST_REAL_HOOK: realHook,
            } : {}),
            ...(protocol ? { GIT_PROTOCOL: protocol } : {}),
          }, stdio: ['pipe', 'pipe', 'pipe'],
        });
        childClosed = once(child, 'close');
        return child;
      });
      const repositories = {
        prepareGit: () => Promise.resolve({ storageKey: `${lockKey}.git`, defaultBranch: 'main', repositoryId: lockKey,
          actorIsOwner: true, operation: 'write' as const, storageGeneration: 1, userId: randomUUID() }),
        recheckGit: () => Promise.resolve({ storageKey: `${lockKey}.git`, defaultBranch: 'main', repositoryId: lockKey,
          actorIsOwner: true, operation: 'write' as const, storageGeneration: 1, userId: randomUUID() }),
      };
      const pushJournal = {
        begin: () => Promise.resolve({ operationId: randomUUID() }),
        recordChildSuccess: () => Promise.resolve(true),
        finish: () => Promise.resolve(true),
        fail: () => Promise.resolve(undefined),
        markChildFailed: () => Promise.resolve(undefined),
        markNeedsReconciliation: () => Promise.resolve(undefined),
      };
      service = new GitHttpService(repositories as never, storage, config, locks, pushJournal as never);
      const requestStream = Object.assign(new PassThrough(), {
        query: {},
        headers: { 'content-type': 'application/x-git-receive-pack-request', 'content-length': String(body.length) },
        aborted: false,
      });
      const request = requestStream as unknown as Request;
      const responseStream = new PassThrough();
      const responseHeaders = new Map<string, string>();
      const response = Object.assign(responseStream, {
        statusCode: 200,
        headersSent: false,
        setHeader: (name: string, value: string) => { responseHeaders.set(name, value); return responseStream; },
        status: (code: number) => { (responseStream as unknown as { statusCode: number }).statusCode = code; return responseStream; },
        type: (value: string) => { responseHeaders.set('Content-Type', value); return responseStream; },
      }) as unknown as Response;
      responseStream.resume();
      const serving = service.serve('alice', 'lock-valid-pack.git', 'git-receive-pack', request, response);
      requestStream.end(body);
      await serving;
      const runningChild = child;
      if (!runningChild) throw new Error('Git push process was not captured.');
      childClosed ??= once(runningChild, 'close');
      await withTimeout((async () => {
        while (!existsSync(hookStarted)) await delay(20);
      })(), 5_000, 'Git pre-receive hook barrier');
      const hookState = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(hookStarted, 'utf8'))) as {
        pid: number; refs: string;
      };
      expect(hookState.refs).toContain(`${absentRefSha} ${newSha} ${featureRef}`);

      const lockPidResult = await monitor.query<{ pid: number }>(
        'SELECT pid FROM pg_stat_activity WHERE application_name = $1', [applicationName],
      );
      const lockPid = lockPidResult.rows[0]?.pid;
      if (!lockPid) throw new Error('The lock-owning PostgreSQL connection did not expose its backend PID.');
      const terminated = await monitor.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated', [lockPid],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      await withTimeout(childClosed, 5_000, 'Git receive-pack cancellation');
      expect(runningChild.signalCode).toBe('SIGKILL');
      await waitForProcessExit(hookState.pid, 5_000);
      expect(response.statusCode).toBe(503);
      const actualSha = execFileSync('git', ['--git-dir', repositoryPath, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8', env: gitEnv }).trim();
      expect(actualSha).toBe(oldSha);
      const featureSha = execFileSync('git', ['--git-dir', repositoryPath, 'for-each-ref', '--format=%(refname)', featureRef], {
        encoding: 'utf8', env: gitEnv,
      }).trim();
      expect(featureSha).toBe('');

      await withTimeout((async () => {
        while (true) {
          const result = await monitor.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1', [applicationName],
          );
          if (result.rows[0]?.count === '0') return;
          await delay(25);
        }
      })(), 5_000, 'Repository lock pool release');
      service.onModuleDestroy();
      service = undefined;
      await locks.onModuleDestroy();
      poolEnded = true;
    } finally {
      let childClosedConfirmed = !child;
      let cleanupFailure: unknown;
      if (child) {
        try {
          await stopChild(child, process.platform !== 'win32');
          if (childClosed) await withTimeout(childClosed, 2_000, 'Git receive-pack process close');
          childClosedConfirmed = true;
        } catch (error) {
          cleanupFailure = new Error(
            `Git receive-pack process group did not close; preserving test storage at ${gitRoot}.`,
            { cause: error },
          );
        }
      }
      try {
        try { service?.onModuleDestroy(); }
        catch (error) { cleanupFailure ??= error; }
        if (!poolEnded) {
          try {
            await locks.onModuleDestroy();
            poolEnded = true;
          } catch (error) { cleanupFailure ??= error; }
        }
      } finally {
        try {
          try { await monitor.end(); }
          catch (error) { cleanupFailure ??= error; }
        } finally {
          if (childClosedConfirmed) {
            try { await rm(gitRoot, { recursive: true, force: true }); }
            catch (error) { cleanupFailure ??= error; }
          }
        }
      }
      if (cleanupFailure) await failCleanup(cleanupFailure);
    }
  }, 30_000);
});

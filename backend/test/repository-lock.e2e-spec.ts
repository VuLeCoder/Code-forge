import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
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

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.write('release\n');
  child.stdin.end();
  const closed = once(child, 'close').then(() => true);
  const exited = await Promise.race([closed, delay(2_000).then(() => false)]);
  if (exited) return;
  child.kill();
  await withTimeout(closed, 2_000, 'Child lock process shutdown');
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
});

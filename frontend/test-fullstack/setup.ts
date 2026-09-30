import { randomBytes } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { once } from 'node:events';

export default async function setup() {
  const backend = resolve('../backend');
  const requireBackend = createRequire(join(backend, 'package.json'));
  const { PrismaClient } = requireBackend('@prisma/client') as typeof import('../../backend/test/fullstack-types');
  try { process.loadEnvFile(join(backend, '.env')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const schema = `m38_test_${randomBytes(8).toString('hex')}`;
  const root = await mkdtemp(join(tmpdir(), 'code-forge-m38-'));
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString(), GIT_STORAGE_PATH: join(root, 'git'),
    NODE_ENV: 'test', PORT: '4112', API_PREFIX: 'api/v1', FRONTEND_ORIGIN: 'http://localhost:3112',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), COOKIE_SECURE: 'false', COOKIE_SAME_SITE: 'lax',
    BACKEND_URL: 'http://127.0.0.1:4112', APP_ORIGIN: 'http://localhost:3112' };
  const children: ChildProcess[] = [];
  const logPath = join(root, 'servers.log');
  const fd = openSync(logPath, 'a', 0o600);
  const cleanup = async () => {
    for (const child of children.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await ended;
      clearTimeout(timer);
    }
    closeSync(fd);
    try { await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.$disconnect(); await rm(root, { recursive: true, force: true }); }
  };
  const start = (args: string[], cwd: string) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', fd, fd] });
    children.push(child);
    return child;
  };
  const ready = async (address: string, child: ChildProcess) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Test server exited during startup');
      try { if ((await fetch(address, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Startup pending. */ }
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error('Test server readiness timed out');
  };
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync(process.execPath, [requireBackend.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: backend, env, stdio: 'pipe', timeout: 30_000 });
    const api = start(['dist/main.js'], backend);
    await ready('http://127.0.0.1:4112/api/v1/health/ready', api);
    const web = start([resolve('node_modules/next/dist/bin/next'), 'start', '--port', '3112'], resolve('.'));
    await ready('http://localhost:3112', web);
    const state = join(root, 'state.json');
    await writeFile(state, JSON.stringify({ databaseUrl: url.toString(), root, logPath }), { mode: 0o600 });
    process.env.M38_TEST_STATE = state;
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}

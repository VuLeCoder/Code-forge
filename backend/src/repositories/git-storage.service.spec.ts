import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { GitStorageService } from './git-storage.service';

describe('GitStorageService with real Git', () => {
  let root: string;
  let storage: GitStorageService;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'code-forge-storage-test-'));
    storage = new GitStorageService({ getOrThrow: () => root } as unknown as ConfigService);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('creates an empty bare repository with symbolic default HEAD', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', false, 'Empty');
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.inspect(key, 'main')).toEqual({ state: 'EMPTY', readme: null });
    expect(execFileSync('git', ['--git-dir', join(root, key), 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('refs/heads/main');
  });

  it('commits a README and can detect missing storage', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', true, 'Hello');
    expect(await storage.inspect(key, 'main')).toEqual({ state: 'READY', readme: '# Hello\n' });
    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
  });
});

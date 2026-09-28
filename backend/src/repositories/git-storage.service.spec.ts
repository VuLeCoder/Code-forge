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

  it('lists exact branch names, selects slash refs and rejects missing refs', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', true, 'Branches');
    execFileSync('git', ['--git-dir', join(root, key), 'branch', 'feature/demo']);
    const result = await storage.branches(key, 'main', 'feature/demo');
    expect(result.branches.map((branch) => branch.name)).toEqual(['feature/demo', 'main']);
    expect(result.selectedBranch).toMatchObject({ name: 'feature/demo', isDefault: false });
    expect(result.selectedBranch?.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect((await storage.branches(key, 'main')).selectedBranch?.isDefault).toBe(true);
    await expect(storage.branches(key, 'main', 'missing')).rejects.toMatchObject({ response: { error: { code: 'REF_NOT_FOUND' } } });
    await expect(storage.branches('../escape.git', 'main')).rejects.toThrow();
  });

  it('returns no branches for unborn HEAD and rejects unsafe refs/paths', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', false, 'Empty');
    expect(await storage.branches(key, 'main')).toEqual({ branches: [], defaultBranch: 'main', selectedBranch: null });
    for (const ref of ['', '--help', '../main', 'main~1', 'main:README', 'a.lock', 'a//b', 'a@{0}', 'a\\b', 'a\n', 'x'.repeat(256)]) {
      expect(() => storage.validateRef(ref)).toThrow();
    }
    for (const path of ['/etc/passwd', '../secret', 'a/../b', 'a\\b', 'a\0b', 'a//b']) {
      expect(() => storage.validateSourcePath(path)).toThrow();
    }
    expect(() => storage.validateSourcePath('src/index.ts')).not.toThrow();
    expect(() => storage.validateRef('feature/demo')).not.toThrow();
  });

  it('fails closed when branch count or output exceeds the read limit', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', true, 'Limits');
    const args = ['--git-dir', join(root, key)];
    const sha = execFileSync('git', [...args, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', [...args, 'update-ref', '--stdin'], {
      input: Array.from({ length: 1000 }, (_, i) => `create refs/heads/branch-${i} ${sha}\n`).join(''),
    });
    await expect(storage.branches(key, 'main')).rejects.toMatchObject({ response: { error: { code: 'GIT_READ_LIMIT_EXCEEDED' } } });
    execFileSync('git', [...args, 'update-ref', '--stdin'], {
      input: Array.from({ length: 700 }, (_, i) => `create refs/heads/a${'x'.repeat(200)}-${i} ${sha}\n`).join(''),
    });
    await expect(storage.branches(key, 'main')).rejects.toMatchObject({ response: { error: { code: 'GIT_READ_UNAVAILABLE' } } });
  });
});

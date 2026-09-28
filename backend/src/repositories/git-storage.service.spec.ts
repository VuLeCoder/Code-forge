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

  it('reads exact nested trees, distinguishes special entries and isolates repositories', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', true, 'Tree');
    const git = (args: string[], input?: string) => execFileSync('git', ['--git-dir', join(root, key), ...args], { encoding: 'utf8', input }).trim();
    const oldCommit = git(['rev-parse', 'HEAD']);
    const blob = git(['rev-parse', 'HEAD:README.md']);
    const nested = git(['mktree', '-z'], `100644 blob ${blob}\tspace & ü.txt\0`);
    const tree = git(['mktree', '-z'], `040000 tree ${nested}\tsrc # ü\0` +
      `040000 tree ${nested}\t:(glob)*\0` + `120000 blob ${blob}\tlink\0` +
      `160000 commit ${oldCommit}\tmodule\0` + `100644 blob ${blob}\tREADME.md\0`);
    const commit = execFileSync('git', ['--git-dir', join(root, key), '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', tree, '-m', 'Tree'], { encoding: 'utf8' }).trim();
    git(['update-ref', 'refs/heads/feature/tree', commit]);
    const branch = (await storage.branches(key, 'main', 'feature/tree')).selectedBranch!;
    const rootTree = await storage.tree(key, branch.commitSha);
    expect(rootTree.entries.map((entry) => entry.type)).toEqual(['directory', 'directory', 'file', 'symlink', 'submodule']);
    expect((await storage.tree(key, commit, 'src # ü')).entries).toEqual([
      expect.objectContaining({ name: 'space & ü.txt', path: 'src # ü/space & ü.txt', type: 'file' }),
    ]);
    expect((await storage.tree(key, commit, ':(glob)*')).entries).toHaveLength(1);
    expect((await storage.tree(key, oldCommit)).entries.map((entry) => entry.name)).toEqual(['README.md']);
    for (const path of ['link', 'README.md']) await expect(storage.tree(key, commit, path)).rejects.toMatchObject({ response: { error: { code: 'PATH_NOT_DIRECTORY' } } });
    for (const path of ['missing', 'link/secret']) await expect(storage.tree(key, commit, path)).rejects.toMatchObject({ response: { error: { code: 'PATH_NOT_FOUND' } } });
    await expect(storage.tree(key, commit, '../secret')).rejects.toMatchObject({ response: { error: { code: 'INVALID_PATH' } } });
    const other = `${randomUUID()}.git`;
    await storage.create(other, 'main', true, 'Other');
    await expect(storage.tree(other, commit)).rejects.toThrow();
    await expect(storage.tree('../escape.git', commit)).rejects.toThrow();
  });

  it('rejects oversized trees without returning partial entries', async () => {
    const key = `${randomUUID()}.git`;
    await storage.create(key, 'main', true, 'Limits');
    const git = (args: string[], input?: string) => execFileSync('git', ['--git-dir', join(root, key), ...args], { encoding: 'utf8', input }).trim();
    const blob = git(['rev-parse', 'HEAD:README.md']);
    for (const [count, width, code] of [[1001, 5, 'GIT_READ_LIMIT_EXCEEDED'], [800, 200, 'GIT_READ_UNAVAILABLE']] as const) {
      const tree = git(['mktree', '-z'], Array.from({ length: count }, (_, i) => `100644 blob ${blob}\t${'x'.repeat(width)}${i}\0`).join(''));
      const commit = execFileSync('git', ['--git-dir', join(root, key), '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit-tree', tree, '-m', 'Large'], { encoding: 'utf8' }).trim();
      await expect(storage.tree(key, commit)).rejects.toMatchObject({ response: { error: { code } } });
    }
  });
});

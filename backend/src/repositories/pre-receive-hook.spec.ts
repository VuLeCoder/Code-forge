import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('pre-receive branch protection', () => {
  let root: string;
  let bare: string;
  let work: string;
  const hook = join(__dirname, 'pre-receive-hook.cjs');
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'code-forge-hook-test-'));
    bare = join(root, 'repo.git');
    work = join(root, 'work');
    git(['init', '--bare', bare]);
    git(['init', '--initial-branch=main', work]);
    git(['-C', work, 'config', 'user.name', 'Hook Test']);
    git(['-C', work, 'config', 'user.email', 'hook@example.test']);
    await writeFile(join(work, 'README.md'), 'first\n');
    git(['-C', work, 'add', 'README.md']);
    git(['-C', work, 'commit', '-m', 'First']);
    await writeFile(join(work, 'README.md'), 'second\n');
    git(['-C', work, 'commit', '-am', 'Second']);
    const first = git(['-C', work, 'rev-parse', 'HEAD^']);
    const second = git(['-C', work, 'rev-parse', 'HEAD']);
    git(['--git-dir', bare, 'fetch', work, first]);
    git(['--git-dir', bare, 'fetch', work, second]);
    git(['--git-dir', bare, 'update-ref', 'refs/heads/main', first]);
  });

  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  function run(oldSha: string, newSha: string, ref: string, actorIsOwner: boolean) {
    return spawnSync(process.execPath, [hook], {
      cwd: root,
      input: `${oldSha} ${newSha} ${ref}\n`,
      encoding: 'utf8',
      env: { ...process.env, GIT_DIR: bare, CODE_FORGE_DEFAULT_BRANCH: 'main',
        CODE_FORGE_ALLOW_DEFAULT_BRANCH_INITIALIZATION: String(actorIsOwner),
        CODE_FORGE_MAX_FILE_BYTES: String(1024 * 1024), CODE_FORGE_MAX_REPOSITORY_BYTES: String(4 * 1024 * 1024) },
      timeout: 10_000,
    });
  }

  it('rejects owner and WRITE direct updates to the default branch without moving its ref', () => {
    const first = git(['--git-dir', bare, 'rev-parse', 'refs/heads/main']);
    const second = git(['-C', work, 'rev-parse', 'HEAD']);

    for (const actorIsOwner of [false, true]) {
      const result = run(first, second, 'refs/heads/main', actorIsOwner);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('branch mặc định chỉ được cập nhật qua pull request');
      expect(git(['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).toBe(first);
    }
  });

  it('allows only the owner to initialize an empty default branch and allows feature branches', () => {
    const first = git(['-C', work, 'rev-parse', 'HEAD^']);
    const zero = '0'.repeat(first.length);
    git(['--git-dir', bare, 'update-ref', '-d', 'refs/heads/main']);

    expect(run(zero, first, 'refs/heads/main', false).status).toBe(1);
    expect(run(zero, first, 'refs/heads/main', true).status).toBe(0);
    expect(run(zero, first, 'refs/heads/feature/topic', false).status).toBe(0);
  });
});

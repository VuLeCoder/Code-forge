import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('pre-receive branch protection', () => {
  let root: string;
  let bare: string;
  let work: string;
  const hook = join(__dirname, 'pre-receive-hook.cjs');
  const git = (args: string[], input?: string) => execFileSync('git', args, { encoding: 'utf8', input }).trim();

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

  it('accepts a 255-byte branch suffix and rejects a 256-byte suffix before ref update', () => {
    const first = git(['-C', work, 'rev-parse', 'HEAD^']);
    const zero = '0'.repeat(first.length);
    const acceptedBranch = `${'a'.repeat(127)}/${'a'.repeat(127)}`;
    const rejectedBranch = `${'b'.repeat(128)}/${'b'.repeat(127)}`;

    const accepted = run(zero, first, `refs/heads/${acceptedBranch}`, false);
    expect(accepted.status).toBe(0);

    const rejected = run(zero, first, `refs/heads/${rejectedBranch}`, false);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('branch vượt quá 255 byte');
    expect(git(['--git-dir', bare, 'for-each-ref', '--format=%(refname)', 'refs/heads/']))
      .toBe('refs/heads/main');
  });

  it('measures branch limits in UTF-8 bytes, not JavaScript characters', () => {
    const first = git(['-C', work, 'rev-parse', 'HEAD^']);
    const zero = '0'.repeat(first.length);
    const branchAtLimit = `${'é'.repeat(63)}a/${'é'.repeat(63)}a`; // 255 UTF-8 bytes
    const branchOverLimit = `${'é'.repeat(64)}/${'é'.repeat(63)}a`; // 256 UTF-8 bytes

    expect(Buffer.byteLength(branchAtLimit, 'utf8')).toBe(255);
    expect(Buffer.byteLength(branchOverLimit, 'utf8')).toBe(256);
    expect(run(zero, first, `refs/heads/${branchAtLimit}`, false).status).toBe(0);

    const rejected = run(zero, first, `refs/heads/${branchOverLimit}`, false);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('branch vượt quá 255 byte');
  });

  it('accepts a push that reaches 1,000 branches and rejects branch 1,001 before ref movement', () => {
    const first = git(['-C', work, 'rev-parse', 'HEAD^']);
    const second = git(['-C', work, 'rev-parse', 'HEAD']);
    const zero = '0'.repeat(first.length);
    const existingBranchUpdates = Array.from({ length: 998 }, (_, index) =>
      `update refs/heads/fixture-${String(index + 1).padStart(4, '0')} ${first}`).join('\n');
    git(['--git-dir', bare, 'update-ref', '--stdin'], `${existingBranchUpdates}\n`);

    const refsBeforeBoundaryPush = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)', 'refs/heads/'])
      .split('\n').filter(Boolean);
    expect(refsBeforeBoundaryPush).toHaveLength(999);

    const branchAtLimit = 'refs/heads/feature/branch-1000';
    const accepted = run(zero, second, branchAtLimit, false);
    expect(accepted.status).toBe(0);

    // Git moves refs only after every pre-receive hook accepts the update.
    git(['--git-dir', bare, 'update-ref', branchAtLimit, second]);
    const refsAtLimit = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)', 'refs/heads/'])
      .split('\n').filter(Boolean);
    expect(refsAtLimit).toHaveLength(1000);

    const branchOverLimit = 'refs/heads/feature/branch-1001';
    const rejected = run(zero, second, branchOverLimit, false);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('repository vượt giới hạn 1000 branch');
    const refsAfterRejectedPush = git(['--git-dir', bare, 'for-each-ref', '--sort=refname', '--format=%(refname)', 'refs/heads/'])
      .split('\n').filter(Boolean);
    expect(refsAfterRejectedPush).toEqual(refsAtLimit);
    expect(refsAfterRejectedPush).not.toContain(branchOverLimit);
  });
});

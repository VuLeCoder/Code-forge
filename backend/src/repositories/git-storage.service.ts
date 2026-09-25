import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const runFile = promisify(execFile);

@Injectable()
export class GitStorageService {
  constructor(private readonly config: ConfigService) {}

  private root() { return resolve(this.config.getOrThrow<string>('GIT_STORAGE_PATH')); }

  private path(key: string) {
    if (!/^[0-9a-f-]{36}\.git$/.test(key)) throw new Error('Invalid storage key');
    return join(this.root(), key);
  }

  private async git(args: string[], env?: NodeJS.ProcessEnv) {
    return runFile('git', args, { timeout: 15_000, maxBuffer: 128 * 1024, env: { ...process.env, ...env } });
  }

  async exists(key: string) {
    try { return (await stat(this.path(key))).isDirectory(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  async create(key: string, branch: string, readme: boolean, name: string) {
    const root = this.root();
    const target = this.path(key);
    await mkdir(root, { recursive: true });
    const stage = join(root, `.stage-${randomUUID()}`);
    let work: string | undefined;
    try {
      await this.git(['init', '--bare', `--initial-branch=${branch}`, stage]);
      if (readme) {
        work = await mkdtemp(join(tmpdir(), 'code-forge-readme-'));
        await this.git(['-C', work, 'init', `--initial-branch=${branch}`]);
        await writeFile(join(work, 'README.md'), `# ${name}\n`, { flag: 'wx' });
        await this.git(['-C', work, 'add', 'README.md']);
        await this.git(['-C', work, '-c', 'user.name=Code Forge', '-c', 'user.email=system@codeforge.invalid', 'commit', '-m', 'Initial README'], {
          GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        });
        await this.git(['-C', work, 'push', stage, `HEAD:refs/heads/${branch}`]);
      }
      await rename(stage, target);
    } catch (error) {
      throw new ServiceUnavailableException({ error: { code: 'GIT_STORAGE_UNAVAILABLE', message: 'Không thể khởi tạo Git storage.' } }, { cause: error });
    } finally {
      await rm(stage, { recursive: true, force: true });
      if (work) await rm(work, { recursive: true, force: true });
    }
  }

  async remove(key: string) { await rm(this.path(key), { recursive: true, force: true }); }

  async inspect(key: string, branch: string): Promise<{ state: 'READY' | 'EMPTY'; readme: string | null }> {
    const path = this.path(key);
    try {
      const { stdout: head } = await this.git(['--git-dir', path, 'symbolic-ref', 'HEAD']);
      if (head.trim() !== `refs/heads/${branch}`) throw new Error('Invalid default HEAD');
      try { await this.git(['--git-dir', path, 'rev-parse', '--verify', 'HEAD^{commit}']); }
      catch { return { state: 'EMPTY', readme: null }; }
      try {
        const { stdout } = await this.git(['--git-dir', path, 'show', 'HEAD:README.md']);
        return { state: 'READY', readme: stdout };
      } catch { return { state: 'READY', readme: null }; }
    } catch (error) {
      throw new ServiceUnavailableException({ error: { code: 'GIT_STORAGE_UNAVAILABLE', message: 'Git storage đang không khả dụng.' } }, { cause: error });
    }
  }
}

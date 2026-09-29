import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const runFile = promisify(execFile);

@Injectable()
export class GitStorageService {
  constructor(private readonly config: ConfigService) {}

  openUploadPack(key: string, advertise: boolean, protocol?: string) {
    this.path(key); // Only server-owned UUID keys may enter the CGI environment.
    return spawn('git', ['-c', 'http.receivepack=false', '-c', 'http.getanyfile=false',
      '-c', 'http.uploadpack=true', '-c', 'http.maxRequestBuffer=1048576', 'http-backend'], {
      detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_PROJECT_ROOT: this.root(), GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${key}/${advertise ? 'info/refs' : 'git-upload-pack'}`,
        REQUEST_METHOD: advertise ? 'GET' : 'POST',
        QUERY_STRING: advertise ? 'service=git-upload-pack' : '',
        CONTENT_TYPE: advertise ? '' : 'application/x-git-upload-pack-request',
        ...(protocol ? { GIT_PROTOCOL: protocol } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  validateCommitSha(sha: string) {
    if (typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
      throw new BadRequestException({ error: { code: 'INVALID_SHA', message: 'Cần SHA commit đầy đủ, dạng hex chữ thường.' } });
    }
  }

  validateCommitPage(page?: string) {
    if (page !== undefined && (typeof page !== 'string' || !/^[1-9][0-9]{0,3}$/.test(page) || Number(page) > 1000)) {
      throw new BadRequestException({ error: { code: 'INVALID_PAGE', message: 'Trang phải từ 1 đến 1000.' } });
    }
    return page === undefined ? 1 : Number(page);
  }

  private commitUnavailable() {
    return new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Không thể đọc lịch sử trong giới hạn cho phép.' } });
  }

  private commitMissing() {
    return new NotFoundException({ error: { code: 'COMMIT_NOT_FOUND', message: 'Commit không tồn tại trong lịch sử hiện tại.' } });
  }

  private readonly commitFormat = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B';

  private parseCommits(output: string) {
    if (!output) return [];
    const fields = output.split('\0');
    if (fields.length % 9 !== 0) throw this.commitUnavailable();
    const commits = [];
    for (let i = 0; i < fields.length; i += 9) {
      const [sha, parents, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, message] = fields.slice(i, i + 9) as [string, string, string, string, string, string, string, string, string];
      const parentShas = parents ? parents.split(' ') : [];
      if (![sha, ...parentShas].every((value) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) ||
        !Number.isFinite(Date.parse(authoredAt)) || !Number.isFinite(Date.parse(committedAt))) throw this.commitUnavailable();
      commits.push({ sha, parentShas, author: { name: authorName, email: authorEmail }, authoredAt,
        committer: { name: committerName, email: committerEmail }, committedAt, message,
        subject: message.split('\n')[0] ?? '' });
    }
    return commits;
  }

  // Only commits reachable from a live branch may be read, never dangling objects.
  async commit(key: string, sha: string) {
    this.validateCommitSha(sha);
    const args = ['--git-dir', this.path(key)];
    try {
      const type = (await this.git([...args, 'cat-file', '-t', sha])).stdout.trim();
      if (type !== 'commit') throw this.commitMissing();
      const refs = (await this.git([...args, 'for-each-ref', '--count=1', `--contains=${sha}`, '--format=%(refname)', 'refs/heads/'])).stdout;
      if (!refs.trim()) throw this.commitMissing();
      const output = (await this.git([...args, 'show', '-s', '--no-notes', `--format=format:${this.commitFormat}`, sha, '--'])).stdout;
      const commits = this.parseCommits(output);
      if (commits.length !== 1) throw this.commitUnavailable();
      return commits[0]!;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if ([128, 1].includes((error as { code: number }).code)) throw this.commitMissing();
      throw this.commitUnavailable();
    }
  }

  async commits(key: string, headSha: string, page = 1, snapshot = headSha) {
    this.validateCommitSha(headSha);
    this.validateCommitSha(snapshot);
    this.validateCommitPage(String(page));
    const args = ['--git-dir', this.path(key)];
    try {
      await this.git([...args, 'merge-base', '--is-ancestor', snapshot, headSha]);
      const output = (await this.git([...args, 'log', '--topo-order', '--no-notes', '-z',
        `--format=format:${this.commitFormat}`, '--max-count=21', `--skip=${(page - 1) * 20}`, snapshot, '--'])).stdout;
      const commits = this.parseCommits(output);
      return { commits: commits.slice(0, 20), page, pageSize: 20, hasMore: commits.length > 20, snapshot };
    } catch (error) {
      if ([128, 1].includes((error as { code: number }).code)) throw this.commitMissing();
      throw this.commitUnavailable();
    }
  }

  validateRef(ref: string) {
    if (typeof ref !== 'string' || Buffer.byteLength(ref) > 255 || !ref ||
      [...ref].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || '~^:?*[\\'.includes(char)) || ref.includes('..') || ref.includes('@{') ||
      ref === '@' || ref.startsWith('-') || ref.endsWith('.') ||
      ref.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))) {
      throw new BadRequestException({ error: { code: 'INVALID_REF', message: 'Tên branch không hợp lệ.' } });
    }
  }

  validateSourcePath(path: string) {
    if (typeof path !== 'string' || Buffer.byteLength(path) > 4096 || [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\') ||
      (path !== '' && path.split('/').some((part) => !part || part === '.' || part === '..'))) {
      throw new BadRequestException({ error: { code: 'INVALID_PATH', message: 'Đường dẫn mã nguồn không hợp lệ.' } });
    }
  }

  async branches(key: string, defaultBranch: string, ref?: string) {
    if (ref !== undefined) this.validateRef(ref);
    let stdout: string;
    try {
      ({ stdout } = await this.git(['--git-dir', this.path(key), 'for-each-ref', '--sort=refname',
        '--count=1001', '--format=%(refname)%09%(objectname)', 'refs/heads/']));
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Không thể đọc danh sách branch trong giới hạn cho phép.' } });
    }
    const branches = stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [name, commitSha] = line.split('\t');
      if (!name?.startsWith('refs/heads/') || !commitSha || !/^[a-f0-9]{40,64}$/.test(commitSha)) {
        throw new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Dữ liệu branch không hợp lệ.' } });
      }
      return { name: name.slice('refs/heads/'.length), commitSha, isDefault: name === `refs/heads/${defaultBranch}` };
    });
    if (branches.length > 1000) {
      throw new ServiceUnavailableException({ error: { code: 'GIT_READ_LIMIT_EXCEEDED', message: 'Repository vượt giới hạn 1000 branch.' } });
    }
    const selectedBranch = branches.find((branch) => branch.name === (ref ?? defaultBranch)) ?? null;
    if (ref !== undefined && !selectedBranch) {
      throw new NotFoundException({ error: { code: 'REF_NOT_FOUND', message: 'Branch không tồn tại hoặc đã bị xóa.' } });
    }
    return { branches, defaultBranch, selectedBranch };
  }

  async tree(key: string, commitSha: string, path = '') {
    this.validateSourcePath(path);
    if (!/^[a-f0-9]{40,64}$/.test(commitSha)) throw new Error('Invalid commit SHA');
    const args = ['--git-dir', this.path(key)];
    const target = `${commitSha}:${path}`;
    let type: string;
    try {
      type = (await this.git([...args, 'cat-file', '-t', target])).stdout.trim();
    } catch (error) {
      if ((error as { code?: unknown }).code === 128) {
        throw new NotFoundException({ error: { code: 'PATH_NOT_FOUND', message: 'Đường dẫn không tồn tại trên branch này.' } });
      }
      throw new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Không thể đọc cây thư mục.' } });
    }
    if (type !== 'tree') throw new BadRequestException({ error: { code: 'PATH_NOT_DIRECTORY', message: 'Đường dẫn không phải thư mục.' } });
    let stdout: string;
    try {
      ({ stdout } = await this.git([...args, 'ls-tree', '-z', target]));
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Không thể đọc thư mục trong giới hạn cho phép.' } });
    }
    const records = stdout.split('\0').filter(Boolean);
    if (records.length > 1000) throw new ServiceUnavailableException({ error: { code: 'GIT_READ_LIMIT_EXCEEDED', message: 'Thư mục vượt giới hạn 1000 mục.' } });
    const entries = records.map((record) => {
      const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(record);
      if (!match) throw new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Dữ liệu thư mục không hợp lệ.' } });
      const [, mode, objectType, objectSha, name] = match as unknown as [string, string, string, string, string];
      const entryPath = path ? `${path}/${name}` : name;
      let navigable = objectType === 'tree' || (objectType === 'blob' && mode !== '120000');
      try { this.validateSourcePath(entryPath); } catch { navigable = false; }
      return { name, path: entryPath, mode, objectSha,
        type: mode === '120000' ? 'symlink' : objectType === 'commit' ? 'submodule' : objectType === 'tree' ? 'directory' : 'file', navigable };
    });
    entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { path, commitSha, entries };
  }

  async blob(key: string, commitSha: string, path: string, image = false) {
    this.validateSourcePath(path);
    if (!path) throw new BadRequestException({ error: { code: 'INVALID_PATH', message: 'Cần đường dẫn tới file.' } });
    if (!/^[a-f0-9]{40,64}$/.test(commitSha)) throw new Error('Invalid commit SHA');
    const args = ['--git-dir', this.path(key)];
    const unavailable = () => new ServiceUnavailableException({ error: { code: 'GIT_READ_UNAVAILABLE', message: 'Không thể đọc file trong giới hạn cho phép.' } });
    let record: string;
    try { record = (await this.git([...args, 'ls-tree', '-z', commitSha, '--', `:(literal)${path}`])).stdout; }
    catch { throw unavailable(); }
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(record);
    if (!match || match[4] !== path) throw new NotFoundException({ error: { code: 'PATH_NOT_FOUND', message: 'Đường dẫn không tồn tại trên branch này.' } });
    const [, mode, type, objectSha] = match;
    if (type !== 'blob' || mode === '120000') throw new BadRequestException({ error: { code: 'PATH_NOT_FILE', message: 'Đường dẫn không phải file thông thường.' } });
    let size: number;
    try { size = Number((await this.git([...args, 'cat-file', '-s', objectSha!])).stdout.trim()); }
    catch { throw unavailable(); }
    if (!Number.isSafeInteger(size) || size < 0) throw unavailable();
    const metadata = { path, commitSha, objectSha, size, previewByteLimit: 128 * 1024, previewLineLimit: 2000 };
    if (size > 1024 * 1024) return { ...metadata, kind: 'large', content: null, truncated: false };
    let bytes: Buffer;
    try { bytes = (await runFile('git', [...args, 'cat-file', 'blob', objectSha!], { encoding: 'buffer', timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout; }
    catch { throw unavailable(); }
    if (bytes.length !== size) throw unavailable();
    if (image) {
      const mime = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
        : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'image/jpeg'
        : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ? 'image/gif'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : null;
      if (!mime) throw new BadRequestException({ error: { code: 'UNSUPPORTED_IMAGE', message: 'Chỉ hỗ trợ ảnh PNG, JPEG, GIF và WebP.' } });
      return { ...metadata, kind: 'image', mime, content: bytes.toString('base64'), truncated: false };
    }
    let text: string;
    try {
      if (bytes.includes(0)) throw new Error('Binary');
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch { return { ...metadata, kind: 'binary', content: null, truncated: false }; }
    // Streaming decode omits a partial UTF-8 character at the preview boundary.
    let content = size > metadata.previewByteLimit
      ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(0, metadata.previewByteLimit), { stream: true }) : text;
    const lines = content.split('\n');
    if (lines.length > metadata.previewLineLimit) content = lines.slice(0, metadata.previewLineLimit).join('\n');
    return { ...metadata, kind: 'text', content, truncated: content !== text };
  }

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

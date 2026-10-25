import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const runFile = promisify(execFile);

@Injectable()
export class GitStorageService {
  constructor(private readonly config: ConfigService) {}

  openPack(key: string, defaultBranch: string, service: 'git-upload-pack' | 'git-receive-pack', advertise: boolean,
    protocol?: string, actorIsOwner = false) {
    this.path(key); // Only server-owned UUID keys may enter the CGI environment.
    const write = service === 'git-receive-pack';
    return spawn('git', [
      ...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []),
      '-c', `http.receivepack=${write}`,
      '-c', 'http.getanyfile=false',
      '-c', `http.uploadpack=${!write}`,
      '-c', 'http.maxRequestBuffer=1048576',
      ...(write ? ['-c', `core.hooksPath=${resolve(__dirname)}`, '-c', 'receive.denyNonFastForwards=true'] : []),
      'http-backend',
    ], {
      detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_PROJECT_ROOT: this.root(), GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${key}/${advertise ? 'info/refs' : service}`,
        REQUEST_METHOD: advertise ? 'GET' : 'POST',
        QUERY_STRING: advertise ? `service=${service}` : '',
        CONTENT_TYPE: advertise ? '' : `application/x-${service}-request`,
        ...(write ? {
          CODE_FORGE_DEFAULT_BRANCH: defaultBranch,
          CODE_FORGE_ALLOW_DEFAULT_BRANCH_INITIALIZATION: String(actorIsOwner),
          CODE_FORGE_MAX_FILE_BYTES: String(this.config.getOrThrow<number>('MAX_FILE_BYTES')),
          CODE_FORGE_MAX_REPOSITORY_BYTES: String(this.config.getOrThrow<number>('MAX_REPOSITORY_BYTES')),
        } : {}),
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

  async compare(key: string, sourceBranch: string, targetBranch: string, signal?: AbortSignal) {
    this.validateRef(sourceBranch);
    this.validateRef(targetBranch);
    const branches = await this.branches(key, targetBranch, undefined, signal);
    const source = branches.branches.find((branch) => branch.name === sourceBranch);
    const target = branches.branches.find((branch) => branch.name === targetBranch);
    if (!source || !target) throw new NotFoundException({ error: { code: 'REF_NOT_FOUND', message: 'Branch nguồn hoặc đích không tồn tại.' } });
    const args = ['--git-dir', this.path(key)];
    let mergeBase: string;
    try { mergeBase = (await this.git([...args, 'merge-base', target.commitSha, source.commitSha], undefined, 128 * 1024, signal)).stdout.trim(); }
    catch (error) {
      if ([1, 128].includes((error as { code: number }).code)) {
        return { state: 'NO_MERGE_BASE' as const, sourceSha: source.commitSha, targetSha: target.commitSha,
          mergeBase: null, commits: [], files: [], diff: '', diffTruncated: false };
      }
      throw new ServiceUnavailableException({ error: { code: 'GIT_COMPARE_UNAVAILABLE', message: 'Không thể so sánh hai branch.' } });
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(mergeBase)) throw this.commitUnavailable();
    try {
      const commitOutput = (await this.git([...args, 'log', '--topo-order', '--no-notes', '-z',
        `--format=format:${this.commitFormat}`, '--max-count=201', `${target.commitSha}..${source.commitSha}`, '--'], undefined, 128 * 1024, signal)).stdout;
      const commits = this.parseCommits(commitOutput);
      const rawFiles = (await this.git([...args, 'diff', '--name-status', '-z', '--find-renames', mergeBase, source.commitSha], undefined, 128 * 1024, signal)).stdout;
      const tokens = rawFiles.split('\0').filter(Boolean);
      const files: { status: string; path: string; previousPath?: string }[] = [];
      for (let i = 0; i < tokens.length;) {
        const status = tokens[i++]!;
        if (/^R\d+$/.test(status) || /^C\d+$/.test(status)) {
          const previousPath = tokens[i++]; const path = tokens[i++];
          if (!previousPath || !path) throw this.commitUnavailable();
          files.push({ status: status[0]!, previousPath, path });
        } else {
          const path = tokens[i++];
          if (!path || !/^[A-Z]$/.test(status)) throw this.commitUnavailable();
          files.push({ status, path });
        }
      }
      if (commits.length > 200 || files.length > 200) throw new ServiceUnavailableException({ error: { code: 'GIT_COMPARE_LIMIT_EXCEEDED', message: 'So sánh vượt giới hạn 200 commit hoặc 200 file.' } });
      const { stdout: rawDiff } = await this.git([...args, 'diff', '--no-ext-diff', '--no-color', '--no-textconv', '--unified=3', mergeBase, source.commitSha], undefined, 1024 * 1024 + 1, signal);
      const sections = rawDiff.split(/(?=^diff --git )/m);
      const kept: string[] = [];
      let usedBytes = 0;
      let diffTruncated = false;
      for (const section of sections) {
        const bytes = Buffer.from(section);
        if (usedBytes >= 1024 * 1024) { diffTruncated = true; break; }
        const fileLimit = Math.min(bytes.length, 128 * 1024, 1024 * 1024 - usedBytes);
        if (fileLimit < bytes.length) diffTruncated = true;
        kept.push(bytes.subarray(0, fileLimit).toString('utf8'));
        usedBytes += fileLimit;
      }
      if (sections.length > kept.length) diffTruncated = true;
      const diff = kept.join('');
      return { state: commits.length ? 'READY' as const : 'ALREADY_MERGED' as const,
        sourceSha: source.commitSha, targetSha: target.commitSha, mergeBase, commits, files,
        diff, diffTruncated };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ error: { code: 'GIT_COMPARE_UNAVAILABLE', message: 'Không thể so sánh hai branch trong giới hạn cho phép.' } });
    }
  }

  async createMergeCandidate(key: string, targetBranch: string, targetSha: string, sourceSha: string, pullRequestNumber: number, signal?: AbortSignal) {
    this.validateRef(targetBranch);
    this.validateCommitSha(targetSha);
    this.validateCommitSha(sourceSha);
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new BadRequestException();
    const args = ['--git-dir', this.path(key)];
    const target = (await this.git([...args, 'rev-parse', '--verify', `refs/heads/${targetBranch}^{commit}`], undefined, 128 * 1024, signal)).stdout.trim();
    if (target !== targetSha) throw new ConflictException({ error: { code: 'STALE_COMPARE', message: 'Branch đích đã thay đổi.' } });
    let tree: string;
    try {
      tree = (await this.git([...args, 'merge-tree', '--write-tree', targetSha, sourceSha], undefined, 128 * 1024, signal)).stdout.split('\n')[0]!.trim();
    } catch (error) {
      if ([1, 128].includes((error as { code: number }).code)) throw new ConflictException({ error: { code: 'MERGE_CONFLICT', message: 'Các thay đổi có xung đột và chưa được áp dụng.' } });
      throw new ServiceUnavailableException({ error: { code: 'MERGE_UNAVAILABLE', message: 'Không thể tạo merge candidate.' } });
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree)) throw new ServiceUnavailableException({ error: { code: 'MERGE_UNAVAILABLE', message: 'Git trả về tree không hợp lệ.' } });
    const message = `Merge pull request #${pullRequestNumber}`;
    try {
      const commit = (await this.git([...args, '-c', 'user.name=Code Forge', '-c', 'user.email=system@codeforge.invalid',
        'commit-tree', tree, '-p', targetSha, '-p', sourceSha, '-m', message], undefined, 128 * 1024, signal)).stdout.trim();
      this.validateCommitSha(commit);
      return commit;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({ error: { code: 'MERGE_UNAVAILABLE', message: 'Không thể tạo merge commit.' } });
    }
  }

  async assertMergeCandidateQuota(key: string, candidateSha: string, signal?: AbortSignal) {
    this.validateCommitSha(candidateSha);
    const maxFileBytes = this.config.getOrThrow<number>('MAX_FILE_BYTES');
    const maxRepositoryBytes = this.config.getOrThrow<number>('MAX_REPOSITORY_BYTES');
    const args = ['--git-dir', this.path(key)];
    let listed: string;
    try {
      listed = (await this.git([...args, 'rev-list', '--objects', '--all', candidateSha], undefined, 64 * 1024 * 1024, signal)).stdout;
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'MERGE_QUOTA_CHECK_FAILED', message: 'Không thể kiểm tra quota của pull request.' } });
    }
    const ids = [...new Set(listed.split('\n').filter(Boolean).map((line) => line.split(' ')[0]))];
    if (ids.length > 1_000_000 || ids.some((id) => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id ?? ''))) {
      throw new ServiceUnavailableException({ error: { code: 'MERGE_QUOTA_CHECK_FAILED', message: 'Danh sách object merge vượt giới hạn kiểm tra.' } });
    }
    let details: string;
    try {
      details = ids.length
        ? (await this.gitWithInput([...args, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
          `${ids.join('\n')}\n`, 64 * 1024 * 1024, signal)).stdout
        : '';
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'MERGE_QUOTA_CHECK_FAILED', message: 'Không thể đo quota của pull request.' } });
    }
    let logicalBytes = 0;
    for (const line of details.split('\n').filter(Boolean)) {
      const [id, type, rawSize] = line.split(' ');
      const size = Number(rawSize);
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id ?? '') ||
        !['blob', 'tree', 'commit', 'tag'].includes(type ?? '') || !Number.isSafeInteger(size) || size < 0) {
        throw new ServiceUnavailableException({ error: { code: 'MERGE_QUOTA_CHECK_FAILED', message: 'Metadata object merge không hợp lệ.' } });
      }
      if (type === 'blob' && size > maxFileBytes) {
        throw new ConflictException({ error: { code: 'MERGE_FILE_QUOTA_EXCEEDED', message: 'Merge có file vượt giới hạn kích thước.' } });
      }
      logicalBytes += size;
      if (logicalBytes > maxRepositoryBytes) {
        throw new ConflictException({ error: { code: 'MERGE_REPOSITORY_QUOTA_EXCEEDED', message: 'Merge vượt giới hạn dung lượng repository.' } });
      }
    }
  }

  async compareAndSwapBranch(key: string, branch: string, nextSha: string, expectedSha: string, signal?: AbortSignal) {
    this.validateRef(branch);
    this.validateCommitSha(nextSha);
    this.validateCommitSha(expectedSha);
    try {
      await this.git(['--git-dir', this.path(key), 'update-ref', `refs/heads/${branch}`, nextSha, expectedSha], undefined, 128 * 1024, signal);
    } catch (error) {
      if ([1, 128].includes((error as { code: number }).code)) throw new ConflictException({ error: { code: 'STALE_COMPARE', message: 'Branch đích đã thay đổi.' } });
      throw new ServiceUnavailableException({ error: { code: 'MERGE_REF_UPDATE_FAILED', message: 'Không thể cập nhật branch đích.' } });
    }
  }

  async branchSha(key: string, branch: string) {
    this.validateRef(branch);
    try {
      const sha = (await this.git(['--git-dir', this.path(key), 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`])).stdout.trim();
      this.validateCommitSha(sha);
      return sha;
    } catch (error) {
      if ([1, 128].includes((error as { code: number }).code)) return null;
      throw new ServiceUnavailableException({ error: { code: 'GIT_REF_UNAVAILABLE', message: 'Không thể xác minh branch sau thao tác Git.' } });
    }
  }

  async snapshotRefs(key: string): Promise<Record<string, string>> {
    let stdout: string;
    try {
      ({ stdout } = await this.git(['--git-dir', this.path(key), 'for-each-ref', '--sort=refname',
        '--format=%(refname)%09%(objectname)'], undefined, 1024 * 1024));
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'GIT_REF_SNAPSHOT_UNAVAILABLE', message: 'Không thể xác minh Git refs.' } });
    }
    if (!stdout) return {};
    if (!stdout.endsWith('\n')) {
      throw new ServiceUnavailableException({ error: { code: 'GIT_REF_SNAPSHOT_UNAVAILABLE', message: 'Không thể xác minh Git refs.' } });
    }
    const lines = stdout.slice(0, -1).split('\n');
    if (lines.length > 1000) {
      throw new ServiceUnavailableException({ error: { code: 'GIT_REF_SNAPSHOT_UNAVAILABLE', message: 'Không thể xác minh Git refs.' } });
    }
    const refs: Record<string, string> = {};
    const branchPrefix = 'refs/heads/';
    let previousRef = '';
    for (const line of lines) {
      const separator = line.indexOf('\t');
      const ref = line.slice(0, separator);
      const sha = line.slice(separator + 1);
      try {
        if (!ref.startsWith(branchPrefix)) throw new Error('Unexpected Git ref namespace');
        this.validateRef(ref.slice(branchPrefix.length));
      }
      catch {
        throw new ServiceUnavailableException({ error: { code: 'GIT_REF_SNAPSHOT_UNAVAILABLE', message: 'Không thể xác minh Git refs.' } });
      }
      if (separator < 0 || Buffer.compare(Buffer.from(ref), Buffer.from(previousRef)) <= 0 ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
        throw new ServiceUnavailableException({ error: { code: 'GIT_REF_SNAPSHOT_UNAVAILABLE', message: 'Không thể xác minh Git refs.' } });
      }
      refs[ref] = sha;
      previousRef = ref;
    }
    return refs;
  }

  async isAncestor(key: string, ancestorSha: string, descendantSha: string) {
    this.validateCommitSha(ancestorSha);
    this.validateCommitSha(descendantSha);
    try {
      await this.git(['--git-dir', this.path(key), 'merge-base', '--is-ancestor', ancestorSha, descendantSha]);
      return true;
    } catch (error) {
      if ((error as { code: number }).code === 1) return false;
      throw new ServiceUnavailableException({ error: { code: 'GIT_ANCESTRY_UNAVAILABLE', message: 'Không thể xác minh lịch sử merge.' } });
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

  async branches(key: string, defaultBranch: string, ref?: string, signal?: AbortSignal) {
    if (ref !== undefined) this.validateRef(ref);
    let stdout: string;
    try {
      ({ stdout } = await this.git(['--git-dir', this.path(key), 'for-each-ref', '--sort=refname',
        '--count=1001', '--format=%(refname)%09%(objectname)', 'refs/heads/'], undefined, 128 * 1024, signal));
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

  private async git(args: string[], env?: NodeJS.ProcessEnv, maxBuffer = 128 * 1024, signal?: AbortSignal) {
    return runFile('git', [...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), ...args],
      { timeout: 15_000, maxBuffer, signal, env: { ...process.env, ...env } });
  }

  private async gitWithInput(args: string[], input: string, maxBuffer: number, signal?: AbortSignal) {
    return new Promise<{ stdout: string; stderr: string }>((resolveResult, rejectResult) => {
      const child = spawn('git', [...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []), ...args], {
        env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (error?: Error, value?: { stdout: string; stderr: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) rejectResult(error);
        else resolveResult(value!);
      };
      const abort = () => {
        child.kill('SIGKILL');
        finish(signal?.reason instanceof Error ? signal.reason : new Error('Git operation aborted'));
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(Object.assign(new Error('Git operation timed out'), { code: 'ETIMEDOUT' }));
      }, 15_000);
      child.once('error', (error) => finish(error));
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > maxBuffer) {
          child.kill('SIGKILL');
          finish(Object.assign(new Error('Git output exceeded the configured limit'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > maxBuffer) {
          child.kill('SIGKILL');
          finish(Object.assign(new Error('Git output exceeded the configured limit'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
          return;
        }
        stderr.push(chunk);
      });
      child.once('close', (code) => {
        if (code !== 0) return finish(Object.assign(new Error(Buffer.concat(stderr).toString('utf8') || 'Git command failed'), { code }));
        finish(undefined, { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      if (!settled) child.stdin.end(input);
    });
  }

  private async renameStage(stage: string, target: string) {
    for (let attempt = 0; ; attempt++) {
      try { await rename(stage, target); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || attempt >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 40 * (attempt + 1)));
      }
    }
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
      await this.renameStage(stage, target);
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

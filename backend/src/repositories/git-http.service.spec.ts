import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GitHttpController } from './git-http.controller';
import { GitHttpService } from './git-http.service';
import { GitStorageService } from './git-storage.service';
import { RepositoriesService } from './repositories.service';
import { RepositoryLockService } from './repository-lock.service';
import { GitPushJournalService } from './git-push-journal.service';

describe('Git HTTP process lifecycle', () => {
  let app: INestApplication;
  let service: GitHttpService;
  let url: string;
  let script: string;
  let children: ChildProcessWithoutNullStreams[];
  let logs: jest.SpyInstance;
  let prepareGit: jest.Mock;
  const header = 'Content-Type: application/x-git-upload-pack-advertisement\r\n\r\n';
  const start = jest.fn(() => {
    const child = spawn(process.execPath, ['-e', script], { detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    return child;
  });

  beforeEach(async () => {
    logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    children = [];
    start.mockClear();
    const access = { storageKey: 'key', defaultBranch: 'main', repositoryId: 'repository-id', userId: undefined, actorIsOwner: true, operation: 'read' as const, storageGeneration: 0 };
    prepareGit = jest.fn(() => Promise.resolve(access));
    script = `process.stdout.write(${JSON.stringify(header + '0000')}); setInterval(() => {}, 1000);`;
    const module = await Test.createTestingModule({ controllers: [GitHttpController], providers: [GitHttpService,
      { provide: RepositoriesService, useValue: { prepareGit, recheckGit: jest.fn(() => Promise.resolve(access)) } },
      { provide: RepositoryLockService, useValue: { acquire: jest.fn(() => Promise.resolve({ signal: new AbortController().signal, release: jest.fn() })) } },
      { provide: GitStorageService, useValue: { openPack: start } },
      { provide: GitPushJournalService, useValue: { begin: jest.fn(), recordChildSuccess: jest.fn(), finish: jest.fn(),
        fail: jest.fn(), markChildFailed: jest.fn(), markNeedsReconciliation: jest.fn() } },
      { provide: ConfigService, useValue: { getOrThrow: (key: string) => key === 'MAX_PUSH_BYTES' ? 1024 * 1024 : undefined } },
    ] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    service = app.get(GitHttpService);
    url = `${await app.getUrl()}/git/owner/repo.git`;
  });

  afterEach(async () => { await app.close(); logs.mockRestore(); });

  it('records bounded operational fields without credentials, source or repository names', async () => {
    script = `process.stdout.end(${JSON.stringify(header + '0000')});`;
    const response = await fetch(`${url}/info/refs?service=git-upload-pack`, { headers: {
      Authorization: 'Basic secret-canary', Cookie: 'session=secret-canary', 'X-Request-ID': 'untrusted-canary',
    } });
    await response.text();
    const raw = logs.mock.calls.map(([value]) => String(value)).find((value) => value.includes('"event":"git_read"'))!;
    const event = JSON.parse(raw) as Record<string, unknown>;
    expect(event).toMatchObject({ event: 'git_read', requestId: response.headers.get('x-request-id'), operation: 'upload-pack-discovery',
      status: 200, outcome: 'success' });
    expect(typeof event.durationMs).toBe('number');
    expect(typeof event.activeProcesses).toBe('number');
    expect(raw).not.toMatch(/canary|owner|repo\.git|0000|Authorization|Cookie/);
  });

  it('rejects synchronous spawn failure with a sanitized response', async () => {
    start.mockImplementationOnce(() => { throw new Error('private-path-secret'); });
    const response = await fetch(`${url}/info/refs?service=git-upload-pack`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Git request unavailable.\n');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-path-secret');
  });

  it('kills a streaming process when the response client disconnects', async () => {
    const controller = new AbortController();
    const response = await fetch(`${url}/info/refs?service=git-upload-pack`, { signal: controller.signal });
    expect(response.status).toBe(200);
    const closed = once(children[0]!, 'close');
    controller.abort();
    expect((await closed)[1]).toBe('SIGKILL');
    expect(() => process.kill(children[0]!.pid!, 0)).toThrow();
  });

  it('times out stalled CGI before headers and rejects malformed CGI', async () => {
    jest.replaceProperty(service, 'timeoutMs', 80);
    script = 'setInterval(() => {}, 1000);';
    expect((await fetch(`${url}/info/refs?service=git-upload-pack`)).status).toBe(504);
    script = 'process.stdout.write("x".repeat(9000)); setInterval(() => {}, 1000);';
    expect((await fetch(`${url}/info/refs?service=git-upload-pack`)).status).toBe(503);
  });

  it('limits concurrent processes and releases capacity after cancellation', async () => {
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    for (const controller of controllers) expect((await fetch(`${url}/info/refs?service=git-upload-pack`, { signal: controller.signal })).status).toBe(200);
    expect((await fetch(`${url}/info/refs?service=git-upload-pack`)).status).toBe(503);
    expect(start).toHaveBeenCalledTimes(4);
    const closed = children.map((child) => once(child, 'close'));
    controllers.forEach((controller) => controller.abort());
    await Promise.all(closed);
    script = `process.stdout.end(${JSON.stringify(header + '0000')});`;
    expect(await (await fetch(`${url}/info/refs?service=git-upload-pack`)).text()).toBe('0000');
  });

  it('cancels incomplete uploads and bounds decompressed gzip requests', async () => {
    script = 'process.stdin.resume(); setInterval(() => {}, 1000);';
    const req = request(`${url}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request' } });
    req.on('error', () => {});
    const spawned = new Promise<void>((resolve) => start.mockImplementationOnce(() => {
      const child = spawn(process.execPath, ['-e', script], { detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child); resolve(); return child;
    }));
    req.write('0004');
    await spawned;
    const closed = once(children[0]!, 'close');
    req.destroy();
    expect((await closed)[1]).toBe('SIGKILL');
    const response = await fetch(`${url}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request', 'content-encoding': 'gzip' }, body: gzipSync(Buffer.alloc(1048577)) });
    expect(response.status).toBe(413);
  });

  it('streams responses larger than source preview limits without truncation', async () => {
    script = `process.stdout.write(${JSON.stringify(header)}); process.stdout.end(Buffer.alloc(2 * 1024 * 1024, 97));`;
    const response = await fetch(`${url}/info/refs?service=git-upload-pack`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(2 * 1024 * 1024);
    expect(bytes.every((byte) => byte === 97)).toBe(true);
  });

  it('serves authenticated receive-pack with write authorization and its own content types', async () => {
    const receiveHeader = 'Content-Type: application/x-git-receive-pack-advertisement\r\n\r\n';
    script = `process.stdout.end(${JSON.stringify(receiveHeader + '0000')});`;
    const response = await fetch(`${url}/info/refs?service=git-receive-pack`, { headers: { Authorization: 'Basic test' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-git-receive-pack-advertisement');
    expect(await response.text()).toBe('0000');
    expect(prepareGit).toHaveBeenCalledWith('owner', 'repo', 'Basic test', 'write');
    expect(start).toHaveBeenCalledWith('key', 'main', 'git-receive-pack', true, undefined, true);
    const raw = logs.mock.calls.map(([value]) => String(value)).find((value) => value.includes('"event":"git_write"'))!;
    expect(JSON.parse(raw)).toMatchObject({ event: 'git_write', operation: 'receive-pack-discovery', status: 200 });
  });

  it.each([
    ['nonzero child exit', 'Content-Type: application/x-git-receive-pack-result\r\n\r\n0000', 17, 'failed'],
    ['incomplete CGI headers', 'Content-Type: application/x-git-receive-pack-result', 0, 'failed'],
    ['invalid CGI content type', 'Content-Type: text/plain\r\n\r\n0000', 0, 'failed'],
    ['successful child and complete CGI', 'Content-Type: application/x-git-receive-pack-result\r\n\r\n0000', 0, 'succeeded'],
    ['child-success proof write fails', 'Content-Type: application/x-git-receive-pack-result\r\n\r\n0000', 0, 'unknown'],
  ])('journals receive-pack only after known success: %s', async (_name, payload, exitCode, outcome) => {
    const access = { storageKey: 'key', defaultBranch: 'main', repositoryId: 'repository-id', userId: 'actor-id',
      actorIsOwner: true, operation: 'write' as const, storageGeneration: 3 };
    const repositories = app.get<RepositoriesService, {
      prepareGit: jest.Mock; recheckGit: jest.Mock;
    }>(RepositoriesService);
    repositories.prepareGit.mockResolvedValue(access);
    repositories.recheckGit.mockResolvedValue(access);

    const storage = app.get<GitStorageService, { snapshotRefs: jest.Mock }>(GitStorageService);
    const beforeRefs = { 'refs/heads/main': 'a'.repeat(40) };
    const afterRefs = { 'refs/heads/main': 'b'.repeat(40) };
    storage.snapshotRefs = jest.fn().mockResolvedValueOnce(beforeRefs).mockResolvedValue(afterRefs);
    const journal = app.get<GitPushJournalService, {
      begin: jest.Mock; recordChildSuccess: jest.Mock; finish: jest.Mock;
      markChildFailed: jest.Mock; markNeedsReconciliation: jest.Mock;
    }>(GitPushJournalService);
    journal.begin.mockResolvedValue({ operationId: 'push-operation-id' });
    let startProof!: () => void;
    let commitProof!: (value: boolean) => void;
    const proofStarted = new Promise<void>((resolve) => { startProof = resolve; });
    const proofCommitted = new Promise<boolean>((resolve) => { commitProof = resolve; });
    journal.recordChildSuccess.mockImplementation(() => {
      startProof();
      return outcome === 'unknown' ? Promise.reject(new Error('isolated proof persistence failure')) : proofCommitted;
    });
    const finalized = new Promise<void>((resolve) => {
      journal.finish.mockImplementation(() => { resolve(); return Promise.resolve(true); });
      journal.markChildFailed.mockImplementation(() => { resolve(); return Promise.resolve(); });
      journal.markNeedsReconciliation.mockImplementation(() => { resolve(); return Promise.resolve(); });
    });

    script = `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.end(${JSON.stringify(payload)}); process.exitCode = ${exitCode}; });`;
    const response = fetch(`${url}/git-receive-pack`, {
      method: 'POST',
      headers: { Authorization: 'Basic test', 'Content-Type': 'application/x-git-receive-pack-request' },
      body: '0000',
    }).then((response) => response.text()).catch(() => undefined);
    if (outcome === 'succeeded') {
      await proofStarted;
      expect(storage.snapshotRefs).toHaveBeenCalledTimes(1);
      expect(journal.finish).not.toHaveBeenCalled();
      commitProof(true);
    }
    await response;
    await finalized;

    expect(journal.begin).toHaveBeenCalledWith('repository-id', 'actor-id', 3, beforeRefs);
    if (outcome === 'succeeded') {
      expect(journal.recordChildSuccess).toHaveBeenCalledWith('push-operation-id');
      expect(storage.snapshotRefs).toHaveBeenCalledTimes(2);
      expect(journal.finish).toHaveBeenCalledTimes(1);
      expect(journal.finish).toHaveBeenCalledWith('push-operation-id', afterRefs);
      expect(journal.markNeedsReconciliation).not.toHaveBeenCalled();
      expect(journal.markChildFailed).not.toHaveBeenCalled();
    } else {
      expect(storage.snapshotRefs).toHaveBeenCalledTimes(1);
      expect(journal.finish).not.toHaveBeenCalled();
      if (outcome === 'failed') {
        expect(journal.recordChildSuccess).not.toHaveBeenCalled();
        expect(journal.markChildFailed).toHaveBeenCalledWith('push-operation-id');
        expect(journal.markNeedsReconciliation).not.toHaveBeenCalled();
      } else {
        expect(journal.recordChildSuccess).toHaveBeenCalledWith('push-operation-id');
        expect(journal.markNeedsReconciliation).toHaveBeenCalledWith('push-operation-id');
        expect(journal.markChildFailed).not.toHaveBeenCalled();
      }
    }
  });
});

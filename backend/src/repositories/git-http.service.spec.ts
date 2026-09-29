import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GitHttpController } from './git-http.controller';
import { GitHttpService } from './git-http.service';
import { GitStorageService } from './git-storage.service';
import { RepositoriesService } from './repositories.service';

describe('Git HTTP process lifecycle', () => {
  let app: INestApplication;
  let service: GitHttpService;
  let url: string;
  let script: string;
  let children: ChildProcessWithoutNullStreams[];
  const header = 'Content-Type: application/x-git-upload-pack-advertisement\r\n\r\n';
  const start = jest.fn(() => {
    const child = spawn(process.execPath, ['-e', script], { detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    return child;
  });

  beforeEach(async () => {
    children = [];
    start.mockClear();
    script = `process.stdout.write(${JSON.stringify(header + '0000')}); setInterval(() => {}, 1000);`;
    const module = await Test.createTestingModule({ controllers: [GitHttpController], providers: [GitHttpService,
      { provide: RepositoriesService, useValue: { preparePublicGit: () => Promise.resolve('key') } },
      { provide: GitStorageService, useValue: { openUploadPack: start } },
    ] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    service = app.get(GitHttpService);
    url = `${await app.getUrl()}/git/owner/repo.git`;
  });

  afterEach(async () => { await app.close(); });

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
});

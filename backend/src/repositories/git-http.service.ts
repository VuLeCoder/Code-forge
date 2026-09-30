import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { Request, Response } from 'express';
import { GitStorageService } from './git-storage.service';
import { RepositoriesService } from './repositories.service';

@Injectable()
export class GitHttpService implements OnModuleDestroy {
  private readonly logger = new Logger(GitHttpService.name);
  private readonly running = new Set<() => void>();
  readonly timeoutMs: number = 60_000;

  onModuleDestroy() { for (const stop of this.running) stop(); }

  async serve(owner: string, repository: string, advertise: boolean, req: Request, res: Response) {
    const started = performance.now();
    const requestId = randomUUID();
    let reported = false;
    let failureStatus: number | undefined;
    const report = (aborted: boolean) => {
      if (reported) return;
      reported = true;
      // Fixed fields only: never include URL, query, headers, credentials or Git output.
      this.logger.log(JSON.stringify({ event: 'git_read', requestId,
        operation: advertise ? 'discovery' : 'upload-pack',
        status: failureStatus ?? res.statusCode,
        outcome: aborted ? 'aborted' : (res.statusCode === 200 ? 'success' : 'rejected'),
        durationMs: Math.round(performance.now() - started), activeProcesses: this.running.size,
      }));
    };
    res.setHeader('X-Request-ID', requestId);
    res.once('finish', () => report(false));
    res.once('close', () => report(!res.writableFinished));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reject = (status: number) => { res.status(status).type('text/plain').end('Git request unavailable.\n'); };
    if (!/^[a-z0-9][a-z0-9._-]{1,37}[a-z0-9]$/i.test(owner) ||
      !/^(?!.*\.\.)(?!.*\.git\.git$)[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?\.git$/i.test(repository)) return reject(404);
    let key: string;
    try { key = await this.repositories.prepareGit(owner, repository.slice(0, -4), req.headers.authorization); }
    catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="Code Forge Git", charset="UTF-8"');
      return reject(status === 401 || status === 404 ? status : 503);
    }
    if (req.aborted || res.destroyed) return;
    if (advertise ? (Object.keys(req.query).length !== 1 || req.query.service !== 'git-upload-pack') : Object.keys(req.query).length !== 0) return reject(400);
    const protocol = req.headers['git-protocol'];
    if (protocol !== undefined && (typeof protocol !== 'string' || !/^version=[012]$/.test(protocol))) return reject(400);
    const encoding = req.headers['content-encoding'];
    if (!advertise && (req.headers['content-type'] !== 'application/x-git-upload-pack-request' || (encoding && encoding !== 'gzip' && encoding !== 'identity'))) return reject(415);
    if (Number(req.headers['content-length'] ?? 0) > 1024 * 1024) return reject(413);
    if (this.running.size >= 4) return reject(503);

    let child: ReturnType<GitStorageService['openUploadPack']>;
    try { child = this.storage.openUploadPack(key, advertise, protocol); }
    catch { return reject(503); }
    let stopped = false;
    let header = Buffer.alloc(0);
    let parsed = false;
    let exited = false;
    let drained = false;
    const inputs: Transform[] = [];
    const stop = (status = 503) => {
      if (stopped) return;
      failureStatus = status;
      stopped = true;
      req.unpipe();
      for (const stream of inputs) stream.destroy();
      child.stdin.destroy();
      child.stdout.unpipe();
      output.destroy();
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* Process may have already exited. */ }
      if (!res.destroyed) {
        if (res.headersSent) res.destroy();
        else reject(status);
      }
    };
    const output = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      if (parsed) return callback(null, chunk);
      header = Buffer.concat([header, chunk]);
      const boundary = header.indexOf('\r\n\r\n');
      if (boundary < 0) {
        if (header.length > 8192) return callback(new Error('Invalid CGI headers'));
        return callback();
      }
      if (boundary > 8192) return callback(new Error('Invalid CGI headers'));
      const lines = header.subarray(0, boundary).toString('ascii').split('\r\n');
      const status = lines.find((line) => /^Status:/i.test(line));
      if (status && !/^Status: 200\b/i.test(status)) return callback(new Error('Git failed'));
      const contentType = lines.find((line) => /^Content-Type:/i.test(line))?.slice(13).trim();
      if (contentType !== `application/x-git-upload-pack-${advertise ? 'advertisement' : 'result'}`) return callback(new Error('Invalid Git response'));
      res.status(200).setHeader('Content-Type', contentType);
      parsed = true;
      callback(null, header.subarray(boundary + 4));
      header = Buffer.alloc(0);
    } });
    const limit = () => {
      let bytes = 0;
      const stream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { stop(413); return callback(); }
        callback(null, chunk);
      } });
      inputs.push(stream);
      return stream;
    };
    this.running.add(stop);
    const timer = setTimeout(() => stop(504), this.timeoutMs);
    const cancel = () => stop();
    const cleanup = () => {
      clearTimeout(timer);
      req.off('aborted', cancel);
      res.off('close', cancel);
    };
    const complete = () => {
      if (!stopped && exited && drained) { stopped = true; cleanup(); res.end(); }
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    child.once('error', () => stop());
    child.stdin.on('error', () => stop());
    child.stdout.on('error', () => stop());
    output.on('error', () => stop());
    output.once('end', () => { drained = true; complete(); });
    child.stderr.resume(); // Never expose source paths or Git diagnostics to clients/logs.
    child.stdout.pipe(output).pipe(res, { end: false });
    child.once('close', (code) => {
      if (!stopped) {
        if (code === 0 && parsed) { exited = true; complete(); }
        else stop();
      }
      if (stopped) cleanup();
      this.running.delete(stop);
    });
    if (advertise) child.stdin.end();
    else {
      let input = req.pipe(limit());
      if (encoding === 'gzip') {
        const unzip = createGunzip();
        inputs.push(unzip);
        unzip.on('error', () => stop(400));
        input = input.pipe(unzip).pipe(limit());
      }
      input.pipe(child.stdin);
    }
  }

  constructor(private readonly repositories: RepositoriesService, private readonly storage: GitStorageService) {}
}

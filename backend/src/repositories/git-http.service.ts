import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { GitStorageService } from './git-storage.service';
import { RepositoriesService } from './repositories.service';
import { RepositoryLockService, type RepositoryLock } from './repository-lock.service';
import { GitPushJournalService } from './git-push-journal.service';

@Injectable()
export class GitHttpService implements OnModuleDestroy {
  private readonly logger = new Logger(GitHttpService.name);
  private readonly running = new Set<() => void>();
  readonly timeoutMs: number = 60_000;

  onModuleDestroy() { for (const stop of this.running) stop(); }

  async serve(owner: string, repository: string, requested: 'advertise' | 'git-upload-pack' | 'git-receive-pack', req: Request, res: Response) {
    const advertise = requested === 'advertise';
    let service: 'git-upload-pack' | 'git-receive-pack';
    if (advertise) {
      const queryService = req.query.service;
      if (Object.keys(req.query).length !== 1 ||
        (queryService !== 'git-upload-pack' && queryService !== 'git-receive-pack')) {
        return res.status(400).type('text/plain').end('Git request unavailable.\n');
      }
      service = queryService;
    } else {
      service = requested;
      if (Object.keys(req.query).length !== 0) return res.status(400).type('text/plain').end('Git request unavailable.\n');
    }
    const write = service === 'git-receive-pack';
    const started = performance.now();
    const requestId = randomUUID();
    let reported = false;
    let failureStatus: number | undefined;
    let gitCompleted = false;
    const report = (aborted: boolean) => {
      if (reported) return;
      reported = true;
      // Fixed fields only: never include URL, query, headers, credentials or Git output.
      this.logger.log(JSON.stringify({ event: write ? 'git_write' : 'git_read', requestId,
        operation: advertise ? `${write ? 'receive' : 'upload'}-pack-discovery` : write ? 'receive-pack' : 'upload-pack',
        status: failureStatus ?? res.statusCode,
        outcome: aborted ? 'aborted' : (res.statusCode === 200 && gitCompleted ? 'success' : 'rejected'),
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
    let access: { storageKey: string; defaultBranch: string; repositoryId: string; userId?: string; actorIsOwner: boolean; operation: 'read' | 'write'; storageGeneration: number };
    try { access = await this.repositories.prepareGit(owner, repository.slice(0, -4), req.headers.authorization, write ? 'write' : 'read'); }
    catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="Code Forge Git", charset="UTF-8"');
      return reject(status === 401 || status === 404 ? status : 503);
    }
    if (req.aborted || res.destroyed) return;
    const protocol = req.headers['git-protocol'];
    if (protocol !== undefined && (typeof protocol !== 'string' || !/^version=[012]$/.test(protocol))) return reject(400);
    const encoding = req.headers['content-encoding'];
    if (!advertise && (req.headers['content-type'] !== `application/x-${service}-request` || (encoding && encoding !== 'gzip' && encoding !== 'identity'))) return reject(415);
    const requestLimit = write ? this.config.getOrThrow<number>('MAX_PUSH_BYTES') : 1024 * 1024;
    const rawLength = req.headers['content-length'];
    if (rawLength !== undefined && (!/^\d+$/.test(rawLength) || Number(rawLength) > requestLimit)) return reject(413);
    if (this.running.size >= 4) return reject(503);

    let lock: RepositoryLock | undefined;
    try {
      lock = await this.locks.acquire(access.repositoryId);
      access = await this.repositories.recheckGit(access.repositoryId, access.userId, access.operation);
    } catch (error) {
      if (lock) await lock.release();
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="Code Forge Git", charset="UTF-8"');
      return reject(status === 404 ? 404 : status === 401 ? 401 : 503);
    }
    if (req.aborted || res.destroyed) { await lock.release(); return; }

    let pushOperationId: string | undefined;
    if (write && !advertise) {
      if (!access.userId) { await lock.release(); return reject(401); }
      try {
        const beforeRefs = await this.storage.snapshotRefs(access.storageKey);
        const operation = await this.pushJournal.begin(access.repositoryId, access.userId, access.storageGeneration, beforeRefs);
        pushOperationId = operation.operationId;
      } catch {
        await lock.release();
        return reject(503);
      }
    }

    let child: ReturnType<GitStorageService['openPack']>;
    try { child = this.storage.openPack(access.storageKey, access.defaultBranch, service, advertise, protocol, access.actorIsOwner); }
    catch {
      if (pushOperationId) await this.pushJournal.fail(pushOperationId, 'GIT_PROCESS_START_FAILED').catch(() => undefined);
      await lock.release(); return reject(503);
    }
    let stopped = false;
    let header = Buffer.alloc(0);
    let parsed = false;
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
      if (contentType !== `application/x-${service}-${advertise ? 'advertisement' : 'result'}`) return callback(new Error('Invalid Git response'));
      res.status(200).setHeader('Content-Type', contentType);
      parsed = true;
      callback(null, header.subarray(boundary + 4));
      header = Buffer.alloc(0);
    } });
    const limit = () => {
      let bytes = 0;
      const stream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > requestLimit) { stop(413); return callback(); }
        callback(null, chunk);
      } });
      inputs.push(stream);
      return stream;
    };
    this.running.add(stop);
    const timer = setTimeout(() => stop(504), this.timeoutMs);
    const cancel = () => stop();
    const lockLost = () => stop(503);
    const cleanup = () => {
      clearTimeout(timer);
      req.off('aborted', cancel);
      res.off('close', cancel);
      lock?.signal.removeEventListener('abort', lockLost);
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    lock.signal.addEventListener('abort', lockLost, { once: true });
    child.once('error', () => stop());
    child.stdin.on('error', () => stop());
    child.stdout.on('error', () => stop());
    output.on('error', () => stop());
    output.once('end', () => { drained = true; });
    child.stderr.resume(); // Never expose source paths or Git diagnostics to clients/logs.
    child.stdout.pipe(output).pipe(res, { end: false });
    child.once('close', (code) => {
      void (async () => {
        this.running.delete(stop);
        let journaled = true;
        if (pushOperationId) {
          try {
            const afterRefs = await this.storage.snapshotRefs(access.storageKey);
            journaled = await this.pushJournal.finish(pushOperationId, afterRefs);
          } catch {
            journaled = false;
            await this.pushJournal.markNeedsReconciliation(pushOperationId, 'REF_SNAPSHOT_UNAVAILABLE').catch(() => undefined);
          }
        }
        if (!stopped) {
          if (code === 0 && parsed && drained && journaled) {
            gitCompleted = true;
            stopped = true;
            cleanup();
            res.end();
          } else stop();
        } else cleanup();
        await Promise.resolve(lock?.release()).catch(() => undefined);
      })();
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

  constructor(
    private readonly repositories: RepositoriesService,
    private readonly storage: GitStorageService,
    private readonly config: ConfigService,
    private readonly locks: RepositoryLockService,
    private readonly pushJournal: GitPushJournalService,
  ) {}
}

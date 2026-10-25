import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';

export interface RepositoryLock {
  client: PoolClient;
  signal: AbortSignal;
  release(): Promise<void>;
}

@Injectable()
export class RepositoryLockService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({ connectionString: config.getOrThrow<string>('DATABASE_URL_UNPOOLED'),
      max: 4, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  }

  async acquire(repositoryId: string): Promise<RepositoryLock> {
    const client = await this.pool.connect();
    const abort = new AbortController();
    let released = false;
    const onError = () => abort.abort(new Error('Repository lock connection was lost.'));
    client.on('error', onError);
    try {
      await client.query("SET statement_timeout = '15s'");
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [repositoryId]);
      await client.query('RESET statement_timeout');
    } catch (error) {
      client.removeListener('error', onError);
      client.release(error instanceof Error);
      throw error;
    }
    return { client, signal: abort.signal, release: async () => {
      if (released) return;
      released = true;
      client.removeListener('error', onError);
      if (abort.signal.aborted) { client.release(true); return; }
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [repositoryId]); }
      finally { client.release(); }
    } };
  }

  async onModuleDestroy() { await this.pool.end(); }
}

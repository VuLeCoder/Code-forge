import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { RepositoryLockService } from './repository-lock.service';

describe('RepositoryLockService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('handles repeated client errors until the lost connection is released', async () => {
    const client = new EventEmitter() as EventEmitter & Partial<PoolClient>;
    client.query = jest.fn().mockResolvedValue({ rows: [] });
    client.release = jest.fn();
    jest.spyOn(Pool.prototype, 'connect').mockReturnValue(Promise.resolve(client as PoolClient) as never);
    jest.spyOn(Pool.prototype, 'end').mockReturnValue(undefined);

    const config = { getOrThrow: () => 'postgresql://unused:unused@localhost/unused_test' } as unknown as ConfigService;
    const locks = new RepositoryLockService(config);
    const lock = await locks.acquire('repository');

    client.emit('error', new Error('socket reset'));
    expect(lock.signal.aborted).toBe(true);
    expect(() => client.emit('error', new Error('connection ended'))).not.toThrow();

    await lock.release();
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount('error')).toBe(0);
    await locks.onModuleDestroy();
  });

  it('keeps the socket error listener until unlock settles and destroys a broken client', async () => {
    const client = new EventEmitter() as EventEmitter & Partial<PoolClient>;
    let rejectUnlock!: (error: Error) => void;
    client.query = jest.fn((sql: string) => sql.includes('pg_advisory_unlock')
      ? new Promise((_, reject) => { rejectUnlock = reject; })
      : Promise.resolve({ rows: [] })) as never;
    client.release = jest.fn();
    jest.spyOn(Pool.prototype, 'connect').mockReturnValue(Promise.resolve(client as PoolClient) as never);
    jest.spyOn(Pool.prototype, 'end').mockReturnValue(undefined);

    const config = { getOrThrow: () => 'postgresql://unused:unused@localhost/unused_test' } as unknown as ConfigService;
    const locks = new RepositoryLockService(config);
    const lock = await locks.acquire('repository');
    const release = lock.release();
    const socketError = new Error('socket reset during unlock');
    let emittedError: unknown;
    try { client.emit('error', socketError); }
    catch (error) { emittedError = error; }
    rejectUnlock(socketError);

    await expect(release).rejects.toBe(socketError);
    expect(emittedError).toBeUndefined();
    expect(lock.signal.aborted).toBe(true);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount('error')).toBe(0);
    await locks.onModuleDestroy();
  });

  it('destroys a client if its socket reports an error while unlock resolves', async () => {
    const client = new EventEmitter() as EventEmitter & Partial<PoolClient>;
    let resolveUnlock!: (result: { rows: unknown[] }) => void;
    client.query = jest.fn((sql: string) => sql.includes('pg_advisory_unlock')
      ? new Promise((resolve) => { resolveUnlock = resolve; })
      : Promise.resolve({ rows: [] })) as never;
    client.release = jest.fn();
    jest.spyOn(Pool.prototype, 'connect').mockReturnValue(Promise.resolve(client as PoolClient) as never);
    jest.spyOn(Pool.prototype, 'end').mockReturnValue(undefined);

    const config = { getOrThrow: () => 'postgresql://unused:unused@localhost/unused_test' } as unknown as ConfigService;
    const locks = new RepositoryLockService(config);
    const lock = await locks.acquire('repository');
    const release = lock.release();
    client.emit('error', new Error('socket reset during unlock'));
    resolveUnlock({ rows: [] });

    await release;
    expect(lock.signal.aborted).toBe(true);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount('error')).toBe(0);
    await locks.onModuleDestroy();
  });
});

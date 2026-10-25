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
});

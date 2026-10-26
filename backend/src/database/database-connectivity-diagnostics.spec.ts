import type { LookupAddress } from 'node:dns';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import {
  DATABASE_POSTGRES_PROBE_TIMEOUT_MS,
  DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS,
  connectPostgres,
  withDefaultPrismaConnectTimeout,
  probeDatabaseConnectivity,
  type DatabaseConnectivityProbeDependencies,
} from './database-connectivity-diagnostics';

describe('probeDatabaseConnectivity', () => {
  const lookup = jest.fn<Promise<LookupAddress[]>, [string]>();
  const connect = jest.fn<Promise<void>, [string, number, number]>();
  const connectPostgres = jest.fn<Promise<void>, [string, number]>();
  const dependencies: DatabaseConnectivityProbeDependencies = { lookup, connect, connectPostgres };

  beforeEach(() => {
    lookup.mockReset();
    connect.mockReset();
    connectPostgres.mockReset();
  });

  it('reports hostname, default port, DNS and TCP outcome without exposing URL credentials or resolved IPs', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    connect.mockRejectedValue(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }));

    const result = await probeDatabaseConnectivity(
      'postgresql://private-user:private-password@db.example.test/app?sslmode=require&token=private-query',
      dependencies,
    );

    expect(result).toMatchObject({
      hostname: 'db.example.test',
      port: 5432,
      dns: 'ok',
      tcp: 'failed',
      postgres: 'skipped',
      errorCode: 'ECONNREFUSED',
    });
    expect(connect).toHaveBeenCalledWith('db.example.test', 5432, DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS);
    expect(connectPostgres).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-user|private-password|private-query|203\.0\.113\.10/);
  });

  it('reports a successful PostgreSQL handshake after DNS and TCP succeed', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    connect.mockResolvedValue(undefined);
    connectPostgres.mockResolvedValue(undefined);

    const connectionString = 'postgresql://private-user:private-password@db.example.test/app?sslmode=require&token=private-query';
    const result = await probeDatabaseConnectivity(connectionString, dependencies);

    expect(result).toMatchObject({ dns: 'ok', tcp: 'ok', postgres: 'ok', errorCode: 'NONE' });
    expect(connectPostgres).toHaveBeenCalledWith(connectionString, DATABASE_POSTGRES_PROBE_TIMEOUT_MS);
    expect(JSON.stringify(result)).not.toMatch(/private-user|private-password|private-query|203\.0\.113\.10/);
  });

  it('reports only a normalized PostgreSQL authentication error without exposing the message', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    connect.mockResolvedValue(undefined);
    connectPostgres.mockRejectedValue(Object.assign(
      new Error('authentication failed for private-user with private-password and private-query'),
      { code: '28P01' },
    ));

    const result = await probeDatabaseConnectivity(
      'postgresql://private-user:private-password@db.example.test/app?sslmode=require&token=private-query',
      dependencies,
    );

    expect(result).toMatchObject({ dns: 'ok', tcp: 'ok', postgres: 'failed', errorCode: '28P01' });
    expect(JSON.stringify(result)).not.toMatch(/private-user|private-password|private-query|authentication failed|203\.0\.113\.10/);
  });

  it('reports a bounded PostgreSQL handshake timeout without exposing driver details', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    connect.mockResolvedValue(undefined);
    connectPostgres.mockRejectedValue(Object.assign(
      new Error('timeout while connecting to private-host'),
      { code: 'ETIMEDOUT' },
    ));

    const result = await probeDatabaseConnectivity('postgresql://user:password@db.example.test/app', dependencies);

    expect(result).toMatchObject({ dns: 'ok', tcp: 'ok', postgres: 'failed', errorCode: 'ETIMEDOUT' });
    expect(connectPostgres).toHaveBeenCalledWith(
      'postgresql://user:password@db.example.test/app',
      DATABASE_POSTGRES_PROBE_TIMEOUT_MS,
    );
    expect(JSON.stringify(result)).not.toMatch(/private-host|password|203\.0\.113\.10/);
  });

  it('replaces unrecognized driver codes with UNKNOWN', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    connect.mockResolvedValue(undefined);
    connectPostgres.mockRejectedValue(Object.assign(
      new Error('private connection details'),
      { code: 'PRIVATE_PASSWORD' },
    ));

    const result = await probeDatabaseConnectivity('postgresql://user:password@db.example.test/app', dependencies);

    expect(result).toMatchObject({ dns: 'ok', tcp: 'ok', postgres: 'failed', errorCode: 'UNKNOWN' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PASSWORD|private connection details|password/);
  });

  it('skips TCP when DNS lookup fails and reports only a normalized error code', async () => {
    lookup.mockRejectedValue(Object.assign(new Error('sensitive resolver message'), { code: 'ENOTFOUND' }));

    const result = await probeDatabaseConnectivity('postgresql://user:pass@db.example.test/app', dependencies);

    expect(result).toMatchObject({ dns: 'failed', tcp: 'skipped', errorCode: 'ENOTFOUND' });
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('sensitive resolver message');
  });

  it('redacts IP-literal hosts and rejects non-PostgreSQL URLs without probing', async () => {
    const ipDependencies: DatabaseConnectivityProbeDependencies = {
      lookup: jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]),
      connect: jest.fn().mockResolvedValue(undefined),
      connectPostgres: jest.fn().mockResolvedValue(undefined),
    };
    const ipResult = await probeDatabaseConnectivity('postgresql://user:pass@203.0.113.10:6432/app', ipDependencies);
    const invalidResult = await probeDatabaseConnectivity('https://user:pass@db.example.test/app', dependencies);

    expect(ipResult).toMatchObject({ hostname: '<ip-host-redacted>', postgres: 'ok' });
    expect(JSON.stringify(ipResult)).not.toContain('203.0.113.10');
    expect(ipDependencies.lookup).toHaveBeenCalledWith('203.0.113.10');
    expect(invalidResult).toMatchObject({
      hostname: '<invalid-host>', dns: 'skipped', tcp: 'skipped', postgres: 'skipped', errorCode: 'INVALID_URL',
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(connectPostgres).not.toHaveBeenCalled();
  });

  it('bounds a stalled DNS lookup and does not continue to TCP', async () => {
    jest.useFakeTimers();
    lookup.mockReturnValue(new Promise<LookupAddress[]>(() => undefined));

    const probe = probeDatabaseConnectivity('postgresql://user:pass@db.example.test/app', dependencies);
    await jest.advanceTimersByTimeAsync(DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS);

    await expect(probe).resolves.toMatchObject({
      dns: 'failed',
      tcp: 'skipped',
      postgres: 'skipped',
      errorCode: 'ETIMEDOUT',
    });
    expect(connect).not.toHaveBeenCalled();
    expect(connectPostgres).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('withDefaultPrismaConnectTimeout', () => {
  it('adds a fifteen-second connect timeout when the parameter is absent', () => {
    const result = withDefaultPrismaConnectTimeout('postgresql://user:pass@db.example.test/app');

    expect(new URL(result).searchParams.get('connect_timeout')).toBe('15');
  });

  it('preserves an explicit connect timeout', () => {
    const connectionString = 'postgresql://user:pass@db.example.test/app?connect_timeout=4';

    expect(withDefaultPrismaConnectTimeout(connectionString)).toBe(connectionString);
  });

  it('preserves unrelated query parameters when adding the default', () => {
    const result = withDefaultPrismaConnectTimeout(
      'postgresql://user:pass@db.example.test/app?schema=public&sslmode=require&tag=a%20b',
    );
    const parsed = new URL(result);

    expect(parsed.searchParams.get('schema')).toBe('public');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
    expect(parsed.searchParams.get('tag')).toBe('a b');
    expect(parsed.searchParams.get('connect_timeout')).toBe('15');
  });
});

describe('connectPostgres', () => {
  it('bounds a server that accepts TCP but stalls during PostgreSQL startup', async () => {
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    const startedAt = Date.now();
    try {
      await expect(connectPostgres(
        `postgresql://probe-user:probe-password@127.0.0.1:${address.port}/probe`,
        50,
      )).rejects.toBeDefined();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

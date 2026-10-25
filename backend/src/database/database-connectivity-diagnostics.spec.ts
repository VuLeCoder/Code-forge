import type { LookupAddress } from 'node:dns';
import {
  DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS,
  withDefaultPrismaConnectTimeout,
  probeDatabaseConnectivity,
  type DatabaseConnectivityProbeDependencies,
} from './database-connectivity-diagnostics';

describe('probeDatabaseConnectivity', () => {
  const lookup = jest.fn<Promise<LookupAddress[]>, [string]>();
  const connect = jest.fn<Promise<void>, [string, number, number]>();
  const dependencies: DatabaseConnectivityProbeDependencies = { lookup, connect };

  beforeEach(() => {
    lookup.mockReset();
    connect.mockReset();
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
      errorCode: 'ECONNREFUSED',
    });
    expect(connect).toHaveBeenCalledWith('db.example.test', 5432, DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS);
    expect(JSON.stringify(result)).not.toMatch(/private-user|private-password|private-query|203\.0\.113\.10/);
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
    };
    const ipResult = await probeDatabaseConnectivity('postgresql://user:pass@203.0.113.10:6432/app', ipDependencies);
    const invalidResult = await probeDatabaseConnectivity('https://user:pass@db.example.test/app', dependencies);

    expect(ipResult.hostname).toBe('<ip-host-redacted>');
    expect(JSON.stringify(ipResult)).not.toContain('203.0.113.10');
    expect(ipDependencies.lookup).toHaveBeenCalledWith('203.0.113.10');
    expect(invalidResult).toMatchObject({ hostname: '<invalid-host>', dns: 'skipped', tcp: 'skipped', errorCode: 'INVALID_URL' });
    expect(lookup).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('bounds a stalled DNS lookup and does not continue to TCP', async () => {
    jest.useFakeTimers();
    lookup.mockReturnValue(new Promise<LookupAddress[]>(() => undefined));

    const probe = probeDatabaseConnectivity('postgresql://user:pass@db.example.test/app', dependencies);
    await jest.advanceTimersByTimeAsync(DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS);

    await expect(probe).resolves.toMatchObject({
      dns: 'failed',
      tcp: 'skipped',
      errorCode: 'ETIMEDOUT',
    });
    expect(connect).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('withDefaultPrismaConnectTimeout', () => {
  it('adds a ten-second connect timeout when the parameter is absent', () => {
    const result = withDefaultPrismaConnectTimeout('postgresql://user:pass@db.example.test/app');

    expect(new URL(result).searchParams.get('connect_timeout')).toBe('10');
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
    expect(parsed.searchParams.get('connect_timeout')).toBe('10');
  });
});

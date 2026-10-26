import { Logger } from '@nestjs/common';
import * as connectivityDiagnostics from './database-connectivity-diagnostics';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const previousDiagnosticsFlag = process.env.DATABASE_CONNECTIVITY_DIAGNOSTICS;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (previousDiagnosticsFlag === undefined) delete process.env.DATABASE_CONNECTIVITY_DIAGNOSTICS;
    else process.env.DATABASE_CONNECTIVITY_DIAGNOSTICS = previousDiagnosticsFlag;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it('keeps the connectivity probe off by default and still connects Prisma', async () => {
    delete process.env.DATABASE_CONNECTIVITY_DIAGNOSTICS;
    const probe = jest.spyOn(connectivityDiagnostics, 'probeDatabaseConnectivity');
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(probe).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('logs only the sanitized probe result when the startup probe is explicitly enabled', async () => {
    process.env.DATABASE_CONNECTIVITY_DIAGNOSTICS = 'true';
    process.env.DATABASE_URL = 'postgresql://private-user:private-password@db.example.test/app?tag=private-query';
    jest.spyOn(connectivityDiagnostics, 'probeDatabaseConnectivity').mockResolvedValue({
      hostname: 'db.example.test', port: 5432, dns: 'ok', tcp: 'failed', postgres: 'skipped',
      elapsedMs: 25, errorCode: 'ETIMEDOUT',
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new PrismaService();
    jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    const probeLog = log.mock.calls.map(([message]) => String(message)).find((message) => message.includes('Database connectivity probe'));
    expect(probeLog).toContain('"hostname":"db.example.test"');
    expect(probeLog).toContain('"tcp":"failed"');
    expect(probeLog).toContain('"postgres":"skipped"');
    expect(probeLog).not.toMatch(/private-user|private-password|private-query/);
  });

  it('retries a transient P1001 during startup and connects once the database is available', async () => {
    jest.useFakeTimers();
    const service = new PrismaService();
    const unreachable = Object.assign(new Error('database is waking up'), { errorCode: 'P1001' });
    const connect = jest.spyOn(service, '$connect')
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce(undefined);

    const initialization = service.onModuleInit();
    await jest.advanceTimersByTimeAsync(500);

    await expect(initialization).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-connectivity startup errors', async () => {
    const service = new PrismaService();
    const invalidCredentials = Object.assign(new Error('authentication failed'), { errorCode: 'P1000' });
    const connect = jest.spyOn(service, '$connect').mockRejectedValue(invalidCredentials);

    await expect(service.onModuleInit()).rejects.toBe(invalidCredentials);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('stops retrying P1001 after four attempts and preserves the final error', async () => {
    jest.useFakeTimers();
    const service = new PrismaService();
    const unreachable = Object.assign(new Error('database is still unreachable'), { errorCode: 'P1001' });
    const connect = jest.spyOn(service, '$connect').mockRejectedValue(unreachable);

    const initialization = service.onModuleInit();
    const rejection = expect(initialization).rejects.toBe(unreachable);
    await jest.advanceTimersByTimeAsync(3_500);

    await rejection;
    expect(connect).toHaveBeenCalledTimes(4);
  });
});

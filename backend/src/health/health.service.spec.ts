import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { HealthService } from './health.service';

jest.mock('node:child_process', () => {
  const actual = jest.requireActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: jest.fn(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => callback(null, { stdout: 'git version test\n', stderr: '' }),
    ),
  };
});

describe('HealthService', () => {
  let storagePath: string;

  beforeEach(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'code-forge-health-'));
  });

  afterEach(async () => {
    await rm(storagePath, { recursive: true, force: true });
  });

  it('includes the database in a successful readiness result', async () => {
    const config = { getOrThrow: jest.fn().mockReturnValue(storagePath) } as unknown as ConfigService;
    const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const result = await new HealthService(config, prisma).checkReadiness();

    expect(result.status).toBe('ok');
    expect(result.checks.database.status).toBe('up');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is not ready when the database cannot be reached', async () => {
    const config = { getOrThrow: jest.fn().mockReturnValue(storagePath) } as unknown as ConfigService;
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('offline')) } as unknown as PrismaService;
    const result = await new HealthService(config, prisma).checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.database.status).toBe('down');
  });

  it('is not ready and does not expose the storage path when storage is a file', async () => {
    const unwritableStoragePath = join(storagePath, 'storage-is-a-file');
    await writeFile(unwritableStoragePath, 'not a directory');
    const config = { getOrThrow: jest.fn().mockReturnValue(unwritableStoragePath) } as unknown as ConfigService;
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as PrismaService;

    const result = await new HealthService(config, prisma).checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.git.status).toBe('up');
    expect(result.checks.storage.status).toBe('down');
    expect(JSON.stringify(result)).not.toContain(unwritableStoragePath);
  });
});

import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { HealthService } from './health.service';

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
});

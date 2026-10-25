import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { PrismaService } from '../src/database/prisma.service';
import { MaintenanceJobsService } from '../src/maintenance/maintenance-jobs.service';
import type { GitStorageService } from '../src/repositories/git-storage.service';
import { RepositoryLockService } from '../src/repositories/repository-lock.service';
import type { RepositoryPurgeService } from '../src/repositories/repository-purge.service';

function assertIsolatedDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !databaseName.endsWith('_test')) {
    throw new Error('Maintenance lock E2E requires a loopback PostgreSQL database whose name ends in _test.');
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${description} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForBlockedJob(client: Client, applicationName: string): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE application_name = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'
       ) AS blocked`,
      [applicationName],
    );
    if (result.rows[0]?.blocked) return true;
    await delay(25);
  }
  return false;
}

function maintenanceService(
  locks: RepositoryLockService,
  onDatabaseWork: () => Promise<void>,
  purgeDue: jest.Mock,
): MaintenanceJobsService {
  const db = {
    $executeRaw: onDatabaseWork,
    pullRequestMergeOperation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const storage = {} as GitStorageService;
  const purge = { purgeDue };
  return new MaintenanceJobsService(
    db as unknown as PrismaService,
    locks,
    storage,
    purge as unknown as RepositoryPurgeService,
    { assertNoUnresolved: jest.fn().mockResolvedValue(undefined), reconcilePending: jest.fn().mockResolvedValue(undefined) } as never,
  );
}

describe('MaintenanceJobsService PostgreSQL advisory lock', () => {
  it('serializes batches from independent service instances until the first batch releases its lock', async () => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required for maintenance lock E2E tests.');
    assertIsolatedDatabase(connectionString);

    const applicationKey = randomUUID();
    const firstApplicationName = `maintenance-first-${applicationKey}`;
    const secondApplicationName = `maintenance-second-${applicationKey}`;
    const firstConnection = new URL(connectionString);
    firstConnection.searchParams.set('application_name', firstApplicationName);
    const secondConnection = new URL(connectionString);
    secondConnection.searchParams.set('application_name', secondApplicationName);
    const firstLocks = new RepositoryLockService({ getOrThrow: () => firstConnection.toString() } as unknown as ConfigService);
    const secondLocks = new RepositoryLockService({ getOrThrow: () => secondConnection.toString() } as unknown as ConfigService);
    const monitor = new Client({ connectionString });

    let notifyFirstWork!: () => void;
    const firstWorkStarted = new Promise<void>((resolve) => { notifyFirstWork = resolve; });
    let releaseFirstWork!: () => void;
    const firstWorkGate = new Promise<void>((resolve) => { releaseFirstWork = resolve; });
    let firstCall = true;
    let activeWork = 0;
    let maxActiveWork = 0;
    const workOrder: string[] = [];
    const runWork = (label: string) => async () => {
      activeWork += 1;
      maxActiveWork = Math.max(maxActiveWork, activeWork);
      workOrder.push(label);
      try {
        if (label === 'first' && firstCall) {
          firstCall = false;
          notifyFirstWork();
          await firstWorkGate;
        }
      } finally {
        activeWork -= 1;
      }
    };
    const firstPurge = jest.fn().mockResolvedValue(0);
    const secondPurge = jest.fn().mockResolvedValue(0);
    const firstService = maintenanceService(firstLocks, runWork('first'), firstPurge);
    const secondService = maintenanceService(secondLocks, runWork('second'), secondPurge);
    const firstInternals = firstService as unknown as { runScheduled(): Promise<void> };
    const secondInternals = secondService as unknown as { runScheduled(): Promise<void> };
    let firstRun: Promise<void> | undefined;
    let secondRun: Promise<void> | undefined;

    try {
      await monitor.connect();
      firstRun = firstInternals.runScheduled();
      await withTimeout(firstWorkStarted, 5_000, 'First maintenance batch startup');

      secondRun = secondInternals.runScheduled();
      const blocked = await waitForBlockedJob(monitor, secondApplicationName);
      expect(blocked).toBe(true);
      expect(workOrder).toEqual(['first']);
      expect(maxActiveWork).toBe(1);

      releaseFirstWork();
      await withTimeout(Promise.all([firstRun, secondRun]).then(() => undefined), 5_000, 'Maintenance batches completion');

      expect(maxActiveWork).toBe(1);
      expect(workOrder).toEqual(['first', 'first', 'first', 'second', 'second', 'second']);
      expect(firstPurge).toHaveBeenCalledTimes(1);
      expect(firstPurge).toHaveBeenCalledWith(50);
      expect(secondPurge).toHaveBeenCalledTimes(1);
      expect(secondPurge).toHaveBeenCalledWith(50);
    } finally {
      releaseFirstWork();
      if (firstRun || secondRun) {
        const runs = [firstRun, secondRun].filter((run): run is Promise<void> => !!run);
        await Promise.allSettled(runs.map((run) => withTimeout(run, 5_000, 'Maintenance batch cleanup')));
      }
      firstService.onModuleDestroy();
      secondService.onModuleDestroy();
      await Promise.allSettled([firstLocks.onModuleDestroy(), secondLocks.onModuleDestroy(), monitor.end()]);
    }
  }, 20_000);
});

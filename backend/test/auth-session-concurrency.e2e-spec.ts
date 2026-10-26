import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/database/prisma.service';
import { UsersService } from '../src/users/users.service';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

function assertLoopbackTestDatabase(connectionString: string, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !databaseName.endsWith('_test')) {
    throw new Error(`${variableName} must target a loopback PostgreSQL database whose name ends in _test.`);
  }
  return url;
}

async function waitForBarrierWaiter(
  monitor: Client,
  applicationName: string,
  relatedApplicationNames: string[],
  barrierPid: number,
  isSettled: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let waiting = 0;
  while (Date.now() < deadline) {
    const result = await monitor.query<{ waiting: number }>(`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity AS activity
      WHERE activity.application_name = $1
        AND activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND activity.wait_event_type = 'Lock'
        AND pg_blocking_pids(activity.pid) @> ARRAY[$2::int]
    `, [applicationName, barrierPid]);
    waiting = result.rows[0]?.waiting ?? 0;
    if (waiting === 1) return;
    if (isSettled()) {
      throw new Error(`Auth service call for ${applicationName} settled before it queued behind the user-row barrier.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const diagnostics = await monitor.query<{
    applicationName: string | null;
    state: string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    blockers: number[];
    querySnippet: string | null;
  }>(`
    SELECT activity.application_name AS "applicationName", activity.state,
      activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent",
      pg_blocking_pids(activity.pid) AS blockers, LEFT(activity.query, 240) AS "querySnippet"
    FROM pg_stat_activity AS activity
    WHERE activity.datname = current_database()
      AND activity.pid <> pg_backend_pid()
      AND (activity.application_name = ANY($1::text[])
        OR pg_blocking_pids(activity.pid) @> ARRAY[$2::int])
    ORDER BY activity.application_name, activity.pid
  `, [relatedApplicationNames, barrierPid]);
  const details = diagnostics.rows.map(({ applicationName, state, waitEventType, waitEvent, blockers, querySnippet }) =>
    `${applicationName ?? '<unset>'}:${state ?? '<unset>'}:${waitEventType ?? '<none>'}/${waitEvent ?? '<none>'}`
      + ` blockers=[${blockers.join(',')}], query=${querySnippet ?? '<none>'}`);
  throw new Error(
    `Expected one ${applicationName} connection blocked by test barrier PID ${barrierPid}; observed ${waiting}. `
    + `Relevant pg_stat_activity rows: ${details.join(' | ') || '<none>'}`,
  );
}

async function waitForLogoutBehindRefresh(
  monitor: Client,
  logoutApplicationName: string,
  refreshApplicationName: string,
  relatedApplicationNames: string[],
  barrierPid: number,
  isSettled: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let waiting = 0;
  while (Date.now() < deadline) {
    const result = await monitor.query<{ waiting: number }>(`
      WITH refresh_waiter AS (
        SELECT refresh.pid
        FROM pg_stat_activity AS refresh
        WHERE refresh.application_name = $2
          AND refresh.datname = current_database()
          AND refresh.pid <> pg_backend_pid()
          AND refresh.wait_event_type = 'Lock'
          AND pg_blocking_pids(refresh.pid) @> ARRAY[$3::int]
      )
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity AS logout
      WHERE logout.application_name = $1
        AND logout.datname = current_database()
        AND logout.pid <> pg_backend_pid()
        AND logout.wait_event_type = 'Lock'
        AND EXISTS (
          SELECT 1 FROM refresh_waiter
          WHERE pg_blocking_pids(logout.pid) @> ARRAY[refresh_waiter.pid]
        )
    `, [logoutApplicationName, refreshApplicationName, barrierPid]);
    waiting = result.rows[0]?.waiting ?? 0;
    if (waiting === 1) return;
    if (isSettled()) {
      throw new Error('Auth logout call settled before it queued behind the refresh request blocked by the user-row barrier.');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const diagnostics = await monitor.query<{
    applicationName: string | null;
    state: string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    blockers: number[];
    querySnippet: string | null;
  }>(`
    SELECT activity.application_name AS "applicationName", activity.state,
      activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent",
      pg_blocking_pids(activity.pid) AS blockers, LEFT(activity.query, 240) AS "querySnippet"
    FROM pg_stat_activity AS activity
    WHERE activity.datname = current_database()
      AND activity.pid <> pg_backend_pid()
      AND (activity.application_name = ANY($1::text[])
        OR pg_blocking_pids(activity.pid) @> ARRAY[$2::int])
    ORDER BY activity.application_name, activity.pid
  `, [relatedApplicationNames, barrierPid]);
  const details = diagnostics.rows.map(({ applicationName, state, waitEventType, waitEvent, blockers, querySnippet }) =>
    `${applicationName ?? '<unset>'}:${state ?? '<unset>'}:${waitEventType ?? '<none>'}/${waitEvent ?? '<none>'}`
      + ` blockers=[${blockers.join(',')}], query=${querySnippet ?? '<none>'}`);
  throw new Error(
    `Expected ${logoutApplicationName} to wait behind ${refreshApplicationName}, which is blocked by barrier PID ${barrierPid}; `
    + `observed ${waiting}. Relevant pg_stat_activity rows: ${details.join(' | ') || '<none>'}`,
  );
}

function captureOutcome<T>(promise: Promise<T>, onSettled: () => void): Promise<Outcome<T>> {
  return promise.then(
    (value): Outcome<T> => ({ ok: true, value }),
    (error: unknown): Outcome<T> => ({ ok: false, error }),
  ).finally(onSettled);
}

describe('Auth session refresh/logout concurrency with PostgreSQL', () => {
  const schema = `auth_concurrency_test_${randomBytes(8).toString('hex')}`;
  const suffix = randomBytes(6).toString('hex');
  const refreshApplicationName = `auth-refresh-${suffix}`;
  const logoutApplicationName = `auth-logout-${suffix}`;
  const barrierApplicationName = `auth-barrier-${suffix}`;
  const monitorApplicationName = `auth-monitor-${suffix}`;
  let admin: PrismaClient | undefined;
  let seedDb: PrismaClient | undefined;
  let refreshDb: PrismaClient | undefined;
  let logoutDb: PrismaClient | undefined;
  let isolatedUrl: URL;
  let schemaCreated = false;

  beforeAll(async () => {
    const configuredUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
    if (!configuredUrl) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required for integration tests.');
    isolatedUrl = assertLoopbackTestDatabase(configuredUrl, 'database URL');

    if (process.env.DATABASE_URL) {
      const pooledUrl = assertLoopbackTestDatabase(process.env.DATABASE_URL, 'DATABASE_URL');
      if (pooledUrl.hostname !== isolatedUrl.hostname
        || pooledUrl.port !== isolatedUrl.port
        || pooledUrl.pathname !== isolatedUrl.pathname) {
        throw new Error('DATABASE_URL and DATABASE_URL_UNPOOLED must target the same loopback test database.');
      }
    }
    if (process.env.DATABASE_URL_UNPOOLED) {
      const unpooledUrl = assertLoopbackTestDatabase(process.env.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED');
      if (unpooledUrl.hostname !== isolatedUrl.hostname
        || unpooledUrl.port !== isolatedUrl.port
        || unpooledUrl.pathname !== isolatedUrl.pathname) {
        throw new Error('DATABASE_URL_UNPOOLED and DATABASE_URL must target the same loopback test database.');
      }
    }

    admin = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;

    const migrationUrl = new URL(isolatedUrl);
    migrationUrl.searchParams.set('schema', schema);
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        env: {
          ...process.env,
          DATABASE_URL: migrationUrl.toString(),
          DATABASE_URL_UNPOOLED: migrationUrl.toString(),
        },
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch {
      throw new Error('Auth concurrency E2E schema migration failed; command output is intentionally suppressed.');
    }

    const serviceUrl = (applicationName: string) => {
      const url = new URL(migrationUrl);
      url.searchParams.set('application_name', applicationName);
      url.searchParams.set('connection_limit', '4');
      return url.toString();
    };
    seedDb = new PrismaClient({ datasourceUrl: serviceUrl(`auth-seed-${suffix}`) });
    refreshDb = new PrismaClient({ datasourceUrl: serviceUrl(refreshApplicationName) });
    logoutDb = new PrismaClient({ datasourceUrl: serviceUrl(logoutApplicationName) });
    await Promise.all([seedDb.$connect(), refreshDb.$connect(), logoutDb.$connect()]);

    const [refreshIdentity, logoutIdentity] = await Promise.all([
      refreshDb.$queryRaw<{ applicationName: string; schemaName: string }[]>`
        SELECT current_setting('application_name') AS "applicationName", current_schema() AS "schemaName"
      `,
      logoutDb.$queryRaw<{ applicationName: string; schemaName: string }[]>`
        SELECT current_setting('application_name') AS "applicationName", current_schema() AS "schemaName"
      `,
    ]);
    expect(refreshIdentity[0]).toMatchObject({ applicationName: refreshApplicationName, schemaName: schema });
    expect(logoutIdentity[0]).toMatchObject({ applicationName: logoutApplicationName, schemaName: schema });
  }, 60_000);

  afterAll(async () => {
    await Promise.all([
      seedDb?.$disconnect(),
      refreshDb?.$disconnect(),
      logoutDb?.$disconnect(),
    ].filter((operation): operation is Promise<void> => operation !== undefined));
    if (admin) {
      if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });

  it('serializes refresh before logout and revokes the newly issued successor', async () => {
    if (!admin || !seedDb || !refreshDb || !logoutDb) throw new Error('Auth concurrency E2E setup did not finish.');

    const passwordHash = 'test-only-unused-password-hash';
    const user = await seedDb.user.create({ data: {
      username: 'concurrency-owner',
      normalizedUsername: 'concurrency-owner',
      email: 'concurrency-owner@example.test',
      normalizedEmail: 'concurrency-owner@example.test',
      passwordHash,
    } });
    const rawRefreshToken = randomBytes(48).toString('base64url');
    const familyId = randomUUID();
    const oldSession = await seedDb.session.create({ data: {
      userId: user.id,
      familyId,
      tokenHash: createHash('sha256').update(rawRefreshToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } });

    const config = new ConfigService({
      JWT_ACCESS_SECRET: `auth-concurrency-test-secret-${randomBytes(24).toString('hex')}`,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
    });
    const jwt = new JwtService({});
    const refreshService = new AuthService(
      refreshDb as unknown as PrismaService,
      new UsersService(refreshDb as unknown as PrismaService),
      jwt,
      config,
    );
    const logoutService = new AuthService(
      logoutDb as unknown as PrismaService,
      new UsersService(logoutDb as unknown as PrismaService),
      jwt,
      config,
    );

    const barrierUrl = new URL(isolatedUrl);
    barrierUrl.searchParams.set('schema', schema);
    barrierUrl.searchParams.set('application_name', barrierApplicationName);
    const barrier = new Client({ connectionString: barrierUrl.toString() });
    const monitorUrl = new URL(barrierUrl);
    monitorUrl.searchParams.set('application_name', monitorApplicationName);
    const monitor = new Client({ connectionString: monitorUrl.toString() });
    let barrierConnected = false;
    let monitorConnected = false;
    let transactionOpen = false;
    let refreshSettled = false;
    let logoutSettled = false;
    let refreshOutcome: Promise<Outcome<Awaited<ReturnType<AuthService['refresh']>>>> | undefined;
    let logoutOutcome: Promise<Outcome<void>> | undefined;

    try {
      await barrier.connect();
      barrierConnected = true;
      await monitor.connect();
      monitorConnected = true;
      await barrier.query('BEGIN');
      transactionOpen = true;
      const locked = await barrier.query(`SELECT id FROM "${schema}".users WHERE id = $1::uuid FOR UPDATE`, [user.id]);
      expect(locked.rowCount).toBe(1);
      const pidResult = await barrier.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const barrierPid = Number(pidResult.rows[0]?.pid);
      expect(Number.isInteger(barrierPid)).toBe(true);

      refreshOutcome = captureOutcome(refreshService.refresh(rawRefreshToken), () => { refreshSettled = true; });
      const trackedApplications = [refreshApplicationName, logoutApplicationName, barrierApplicationName, monitorApplicationName];
      await waitForBarrierWaiter(monitor, refreshApplicationName, trackedApplications, barrierPid, () => refreshSettled);

      logoutOutcome = captureOutcome(logoutService.logout(rawRefreshToken), () => { logoutSettled = true; });
      await waitForLogoutBehindRefresh(
        monitor,
        logoutApplicationName,
        refreshApplicationName,
        trackedApplications,
        barrierPid,
        () => logoutSettled,
      );

      await barrier.query('COMMIT');
      transactionOpen = false;
      const [refreshResult, logoutResult] = await Promise.all([refreshOutcome, logoutOutcome]);
      if (!refreshResult.ok) throw refreshResult.error;
      if (!logoutResult.ok) throw logoutResult.error;

      const sessions = await seedDb.session.findMany({ where: { familyId }, orderBy: { createdAt: 'asc' } });
      expect(sessions).toHaveLength(2);
      expect(sessions.find((session) => session.id === oldSession.id)?.revokedAt).toBeInstanceOf(Date);
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
      await expect(refreshService.refresh(refreshResult.value.refreshToken))
        .rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    } finally {
      try {
        if (transactionOpen) await barrier.query('ROLLBACK').catch(() => undefined);
        const pending: Promise<unknown>[] = [];
        if (refreshOutcome) pending.push(refreshOutcome);
        if (logoutOutcome) pending.push(logoutOutcome);
        await Promise.all(pending);
      } finally {
        const connectionsToClose: Promise<void>[] = [];
        if (monitorConnected) connectionsToClose.push(monitor.end());
        if (barrierConnected) connectionsToClose.push(barrier.end());
        await Promise.allSettled(connectionsToClose);
      }
    }
  }, 20_000);
});

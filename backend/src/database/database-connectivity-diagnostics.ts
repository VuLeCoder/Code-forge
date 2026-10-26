import { lookup } from 'node:dns/promises';
import { createConnection, isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { Client } from 'pg';

export const DATABASE_CONNECTIVITY_DIAGNOSTICS_ENV = 'DATABASE_CONNECTIVITY_DIAGNOSTICS';
export const DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS = 1_000;
export const DATABASE_POSTGRES_PROBE_TIMEOUT_MS = 15_000;
export const PRISMA_RUNTIME_CONNECT_TIMEOUT_SECONDS = 15;

export type ConnectivityOutcome = 'ok' | 'failed' | 'skipped';

export interface DatabaseConnectivityDiagnostic {
  hostname: string;
  port: number;
  dns: ConnectivityOutcome;
  tcp: ConnectivityOutcome;
  postgres: ConnectivityOutcome;
  elapsedMs: number;
  errorCode: string;
}

export interface DatabaseConnectivityProbeDependencies {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
  connect: (hostname: string, port: number, timeoutMs: number) => Promise<void>;
  connectPostgres: (connectionString: string, timeoutMs: number) => Promise<void>;
}

export async function connectPostgres(connectionString: string, timeoutMs: number): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: timeoutMs });
  let connected = false;
  try {
    await client.connect();
    connected = true;
  } finally {
    // A failed startup handshake may leave the client in a connecting state; calling end()
    // then can wait for a server response that will never arrive. pg destroys the socket
    // when its connectionTimeoutMillis expires and closes it on connection errors.
    if (connected) await client.end().catch(() => undefined);
  }
}

const dependencies: DatabaseConnectivityProbeDependencies = {
  // Node's lookup uses the host OS resolver; `all` returns candidates without logging their addresses.
  // Source: https://nodejs.org/docs/latest-v24.x/api/dns.html#dnslookuphostname-options-callback
  lookup: (hostname) => lookup(hostname, { all: true, order: 'verbatim' }),
  connect: connectTcp,
  connectPostgres,
};

/**
 * Neon recommends a 15-second connect_timeout for Prisma connections during compute cold starts.
 * Preserve any explicitly configured value.
 * Source: https://neon.com/docs/guides/prisma#troubleshooting
 * https://www.prisma.io/docs/orm/v6/overview/databases/postgresql#arguments
 */
export function withDefaultPrismaConnectTimeout(connectionString: string): string {
  try {
    const target = new URL(connectionString);
    if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') return connectionString;
    if (target.searchParams.has('connect_timeout')) return connectionString;

    target.searchParams.set('connect_timeout', String(PRISMA_RUNTIME_CONNECT_TIMEOUT_SECONDS));
    return target.toString();
  } catch {
    return connectionString;
  }
}

function safeHostname(hostname: string): string {
  if (isIP(hostname)) return '<ip-host-redacted>';

  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  const labels = normalized.split('.');
  const isValidDomain = normalized.length <= 253
    && labels.every((label) => label.length > 0 && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  return isValidDomain ? normalized : '<invalid-host>';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string') {
    if (/^[0-9A-Z]{5}$/.test(error.code)) return error.code;
    if (/^ERR_(?:TLS|SSL)_/.test(error.code)) return 'TLS_ERROR';
    const networkCodes = new Set([
      'EACCES', 'EADDRNOTAVAIL', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET',
      'EHOSTUNREACH', 'ENETDOWN', 'ENETUNREACH', 'ENODATA', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT',
    ]);
    if (networkCodes.has(error.code)) return error.code;
  }
  return 'UNKNOWN';
}

function timeoutError(): Error & { code: string } {
  return Object.assign(new Error('Connectivity probe timed out'), { code: 'ETIMEDOUT' });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function connectTcp(hostname: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer: { handle?: NodeJS.Timeout } = {};
    const socket = createConnection({ host: hostname, port });

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer.handle) clearTimeout(timer.handle);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    // Socket timeouts do not close a connection, so the bounded probe explicitly destroys it.
    // Source: https://r2.nodejs.org/docs/latest-v24.x/api/net.html#socketsettimeouttimeout-callback
    timer.handle = setTimeout(() => finish(timeoutError()), timeoutMs);
    socket.once('connect', () => finish());
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error));
  });
}

function invalidResult(startedAt: number, hostname = '<invalid-host>', port = 5432): DatabaseConnectivityDiagnostic {
  return {
    hostname,
    port,
    dns: 'skipped',
    tcp: 'skipped',
    postgres: 'skipped',
    elapsedMs: Math.max(0, Date.now() - startedAt),
    errorCode: 'INVALID_URL',
  };
}

/** Performs bounded DNS, TCP, and PostgreSQL startup/authentication probes without issuing SQL. */
export async function probeDatabaseConnectivity(
  connectionString: string,
  probeDependencies: DatabaseConnectivityProbeDependencies = dependencies,
): Promise<DatabaseConnectivityDiagnostic> {
  const startedAt = Date.now();
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    return invalidResult(startedAt);
  }

  if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
    return invalidResult(startedAt);
  }

  const rawHostname = target.hostname.replace(/^\[|\]$/g, '');
  const hostname = safeHostname(rawHostname);
  const port = target.port ? Number(target.port) : 5432;
  if (!rawHostname || hostname === '<invalid-host>' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return invalidResult(startedAt, hostname, Number.isInteger(port) ? port : 5432);
  }

  try {
    const addresses = await withTimeout(
      probeDependencies.lookup(rawHostname),
      DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS,
    );
    if (addresses.length === 0) {
      return {
        hostname, port, dns: 'failed', tcp: 'skipped',
        postgres: 'skipped',
        elapsedMs: Math.max(0, Date.now() - startedAt), errorCode: 'ENODATA',
      };
    }
  } catch (error) {
    return {
      hostname, port, dns: 'failed', tcp: 'skipped',
      postgres: 'skipped',
      elapsedMs: Math.max(0, Date.now() - startedAt), errorCode: errorCode(error),
    };
  }

  try {
    await withTimeout(
      probeDependencies.connect(rawHostname, port, DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS),
      DATABASE_CONNECTIVITY_PROBE_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      hostname, port, dns: 'ok', tcp: 'failed',
      postgres: 'skipped',
      elapsedMs: Math.max(0, Date.now() - startedAt), errorCode: errorCode(error),
    };
  }

  try {
    await probeDependencies.connectPostgres(connectionString, DATABASE_POSTGRES_PROBE_TIMEOUT_MS);
    return {
      hostname, port, dns: 'ok', tcp: 'ok', postgres: 'ok',
      elapsedMs: Math.max(0, Date.now() - startedAt), errorCode: 'NONE',
    };
  } catch (error) {
    return {
      hostname, port, dns: 'ok', tcp: 'ok', postgres: 'failed',
      elapsedMs: Math.max(0, Date.now() - startedAt), errorCode: errorCode(error),
    };
  }
}

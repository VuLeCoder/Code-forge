import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  DATABASE_CONNECTIVITY_DIAGNOSTICS_ENV,
  probeDatabaseConnectivity,
  withDefaultPrismaConnectTimeout,
} from './database-connectivity-diagnostics';

const DATABASE_CONNECT_MAX_ATTEMPTS = 4;
const DATABASE_CONNECT_INITIAL_RETRY_MS = 500;

function isDatabaseUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'errorCode' in error
    && error.errorCode === 'P1001';
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    super(databaseUrl
      ? { datasources: { db: { url: withDefaultPrismaConnectTimeout(databaseUrl) } } }
      : undefined);
  }

  async onModuleInit(): Promise<void> {
    if (process.env[DATABASE_CONNECTIVITY_DIAGNOSTICS_ENV] === 'true') {
      try {
        const diagnostic = await probeDatabaseConnectivity(process.env.DATABASE_URL ?? '');
        this.logger.log(`Database connectivity probe ${JSON.stringify(diagnostic)}`);
      } catch {
        // Diagnostics must never change the normal Prisma startup outcome.
        this.logger.warn('Database connectivity probe failed unexpectedly; continuing with Prisma connection');
      }
    }

    for (let attempt = 1; attempt <= DATABASE_CONNECT_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        if (!isDatabaseUnavailable(error) || attempt === DATABASE_CONNECT_MAX_ATTEMPTS) throw error;
        const delay = DATABASE_CONNECT_INITIAL_RETRY_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const DATABASE_CONNECT_MAX_ATTEMPTS = 4;
const DATABASE_CONNECT_INITIAL_RETRY_MS = 500;

function isDatabaseUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'errorCode' in error
    && error.errorCode === 'P1001';
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
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

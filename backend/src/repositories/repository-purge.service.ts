import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GitStorageService } from './git-storage.service';

@Injectable()
export class RepositoryPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RepositoryPurgeService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: PrismaService, private readonly storage: GitStorageService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runScheduled(), 60 * 60 * 1000);
    this.timer.unref();
    void this.runScheduled();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async runScheduled() {
    try { await this.purgeDue(); }
    catch (error) { this.logger.error('Repository purge failed; it will retry on the next run.', error); }
  }

  async purgeDue(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let purged = 0;
    try {
      const candidates = await this.db.repository.findMany({
        where: { status: 'DELETED', purgeAfter: { lte: new Date() } },
        orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }], select: { id: true }, take: limit,
      });
      for (const candidate of candidates) {
        try {
          const removed = await this.db.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<{ id: string; storage_key: string }[]>`
              SELECT id, storage_key FROM repositories
              WHERE id = ${candidate.id}::uuid AND status = 'DELETED' AND purge_after <= NOW()
              FOR UPDATE SKIP LOCKED
            `;
            const row = rows[0];
            if (!row) return false;
            // Keep the database row and name reserved if deleting source fails.
            await this.storage.remove(row.storage_key);
            await tx.repository.delete({ where: { id: row.id } });
            return true;
          }, { timeout: 30_000 });
          if (removed) purged++;
        } catch (error) {
          this.logger.warn(`Could not purge repository ${candidate.id}; retrying later.`, error);
        }
      }
      return purged;
    } finally { this.running = false; }
  }
}

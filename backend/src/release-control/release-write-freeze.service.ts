import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReleaseWriteFreezeService {
  private frozen: boolean;
  private activeWriteCount = 0;
  private stateAudited = false;
  private readonly drainWaiters = new Set<() => void>();

  constructor(private readonly config: ConfigService, private readonly db: PrismaService) {
    this.frozen = this.config.getOrThrow<boolean>('WRITE_FREEZE_BOOTSTRAP');
  }

  status() {
    return { frozen: this.frozen, activeWriteCount: this.activeWriteCount };
  }

  beginWrite(): (() => void) | undefined {
    if (this.frozen) return undefined;
    this.activeWriteCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeWriteCount -= 1;
      if (this.activeWriteCount === 0) {
        for (const resolve of this.drainWaiters) resolve();
        this.drainWaiters.clear();
      }
    };
  }

  async setFrozen(actorId: string, frozen: boolean) {
    const previous = this.frozen;
    if (frozen) {
      this.frozen = true;
      await this.waitForDrain();
      if (previous !== frozen || !this.stateAudited) {
        await this.audit(actorId, true, previous);
        this.stateAudited = true;
      }
    } else if (previous !== frozen || !this.stateAudited) {
      // Persist the operator action before writes are admitted again. If the
      // audit fails, the service stays frozen.
      await this.audit(actorId, false, previous);
      this.frozen = false;
      this.stateAudited = true;
    }
    return { ...this.status(), changed: previous !== this.frozen };
  }

  private async audit(actorId: string, frozen: boolean, previous: boolean): Promise<void> {
    await this.db.auditLog.create({ data: {
      actorId,
      action: frozen ? 'RELEASE_WRITE_FREEZE_ENABLED' : 'RELEASE_WRITE_FREEZE_DISABLED',
      targetId: actorId,
      details: { from: previous ? 'FROZEN' : 'OPEN', to: frozen ? 'FROZEN' : 'OPEN',
        activeWriteCount: this.activeWriteCount, channel: 'ADMIN_API' },
    } });
  }

  private async waitForDrain(): Promise<void> {
    if (this.activeWriteCount === 0) return;
    const timeoutMs = this.config.getOrThrow<number>('WRITE_FREEZE_DRAIN_TIMEOUT_MS');
    let timer: NodeJS.Timeout | undefined;
    await new Promise<void>((resolve, reject) => {
      const drained = () => {
        if (timer) clearTimeout(timer);
        this.drainWaiters.delete(drained);
        resolve();
      };
      this.drainWaiters.add(drained);
      timer = setTimeout(() => {
        this.drainWaiters.delete(drained);
        reject(new ServiceUnavailableException({ error: { code: 'WRITE_FREEZE_DRAIN_TIMEOUT',
          message: 'Đã chặn ghi mới nhưng thao tác đang chạy chưa drain kịp.',
          details: { activeWriteCount: this.activeWriteCount } } }));
      }, timeoutMs);
      timer.unref();
    });
  }
}

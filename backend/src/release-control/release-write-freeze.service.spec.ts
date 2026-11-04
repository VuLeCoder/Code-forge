import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import { ReleaseWriteFreezeService } from './release-write-freeze.service';

describe('ReleaseWriteFreezeService', () => {
  const actorId = '22222222-2222-4222-8222-222222222222';

  function makeService(bootstrap = false) {
    const values = { WRITE_FREEZE_BOOTSTRAP: bootstrap, WRITE_FREEZE_DRAIN_TIMEOUT_MS: 1_000 };
    const config = { getOrThrow: jest.fn((key: keyof typeof values) => values[key]) };
    const createAudit = jest.fn().mockResolvedValue({});
    const db = { auditLog: { create: createAudit } };
    return { service: new ReleaseWriteFreezeService(config as unknown as ConfigService,
      db as unknown as PrismaService), createAudit };
  }

  it('blocks new writes immediately and waits for an active write to drain before auditing', async () => {
    const fixture = makeService();
    const release = fixture.service.beginWrite();
    expect(release).toBeDefined();

    const freezing = fixture.service.setFrozen(actorId, true);
    expect(fixture.service.status()).toEqual({ frozen: true, activeWriteCount: 1 });
    expect(fixture.service.beginWrite()).toBeUndefined();
    expect(fixture.createAudit).not.toHaveBeenCalled();

    release?.();
    await expect(freezing).resolves.toEqual({ frozen: true, activeWriteCount: 0, changed: true });
    expect(fixture.createAudit).toHaveBeenCalledWith({ data: {
      actorId,
      action: 'RELEASE_WRITE_FREEZE_ENABLED',
      targetId: actorId,
      details: { from: 'OPEN', to: 'FROZEN', activeWriteCount: 0, channel: 'ADMIN_API' },
    } });
  });

  it('keeps the gate frozen if the unfreeze audit cannot be persisted', async () => {
    const fixture = makeService(true);
    fixture.createAudit.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(fixture.service.setFrozen(actorId, false)).rejects.toThrow('database unavailable');
    expect(fixture.service.status()).toEqual({ frozen: true, activeWriteCount: 0 });
    expect(fixture.service.beginWrite()).toBeUndefined();
  });

  it('audits a bootstrapped frozen state once and treats a repeated request as idempotent', async () => {
    const fixture = makeService(true);

    await expect(fixture.service.setFrozen(actorId, true)).resolves.toMatchObject({ changed: false, frozen: true });
    await expect(fixture.service.setFrozen(actorId, true)).resolves.toMatchObject({ changed: false, frozen: true });

    expect(fixture.createAudit).toHaveBeenCalledTimes(1);
  });
});

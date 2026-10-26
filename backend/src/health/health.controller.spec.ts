import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  const originalRenderGitCommit = process.env.RENDER_GIT_COMMIT;

  afterEach(() => {
    if (originalRenderGitCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = originalRenderGitCommit;
  });

  it('reports that the process is alive', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { checkReadiness: jest.fn() } }],
    }).compile();
    const result = moduleRef.get(HealthController).live();
    expect(result.status).toBe('ok');
    expect(Date.parse(result.timestamp)).not.toBeNaN();
    expect(result.commitSha).toBeNull();
  });

  it('reports the Render deploy commit when it is a valid Git SHA', async () => {
    process.env.RENDER_GIT_COMMIT = 'a'.repeat(40);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { checkReadiness: jest.fn() } }],
    }).compile();

    expect(moduleRef.get(HealthController).live().commitSha).toBe('a'.repeat(40));
  });

  it('does not expose an invalid Render commit environment value', async () => {
    process.env.RENDER_GIT_COMMIT = 'not-a-sha';
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { checkReadiness: jest.fn() } }],
    }).compile();

    expect(moduleRef.get(HealthController).live().commitSha).toBeNull();
  });
});

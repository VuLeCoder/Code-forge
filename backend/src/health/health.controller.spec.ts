import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('reports that the process is alive', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { checkReadiness: jest.fn() } }],
    }).compile();
    const result = moduleRef.get(HealthController).live();
    expect(result.status).toBe('ok');
    expect(Date.parse(result.timestamp)).not.toBeNaN();
  });
});

import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, type ReadinessResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const result = await this.healthService.checkReadiness();
    if (result.status === 'error') throw new ServiceUnavailableException(result);
    return result;
  }
}

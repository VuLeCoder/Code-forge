import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, type ReadinessResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live(): { status: 'ok'; timestamp: string; commitSha: string | null } {
    const renderCommit = process.env.RENDER_GIT_COMMIT ?? '';
    const commitSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(renderCommit) ? renderCommit : null;
    return { status: 'ok', timestamp: new Date().toISOString(), commitSha };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const result = await this.healthService.checkReadiness();
    if (result.status === 'error') throw new ServiceUnavailableException(result);
    return result;
  }
}

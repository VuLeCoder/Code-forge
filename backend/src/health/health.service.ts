import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ReadinessResult = {
  status: 'ok' | 'error';
  checks: {
    git: { status: 'up' | 'down'; version?: string };
    storage: { status: 'up' | 'down'; path: string };
  };
};

@Injectable()
export class HealthService {
  constructor(private readonly config: ConfigService) {}

  async checkReadiness(): Promise<ReadinessResult> {
    const storagePath = this.config.getOrThrow<string>('GIT_STORAGE_PATH');
    const checks: ReadinessResult['checks'] = {
      git: { status: 'down' },
      storage: { status: 'down', path: storagePath },
    };

    try {
      const { stdout } = await execFileAsync('git', ['--version'], { timeout: 2_000 });
      checks.git = { status: 'up', version: stdout.trim() };
    } catch {
      // Keep the default down state; readiness returns the aggregate result.
    }

    try {
      await mkdir(storagePath, { recursive: true });
      await access(storagePath);
      checks.storage = { status: 'up', path: storagePath };
    } catch {
      // Keep the default down state; readiness returns the aggregate result.
    }

    const ready = Object.values(checks).every((check) => check.status === 'up');
    return { status: ready ? 'ok' : 'error', checks };
  }
}

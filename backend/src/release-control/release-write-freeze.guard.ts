import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ALLOW_DURING_WRITE_FREEZE } from './release-write-freeze.decorator';
import { ReleaseWriteFreezeService } from './release-write-freeze.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class ReleaseWriteFreezeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly freeze: ReleaseWriteFreezeService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (!WRITE_METHODS.has(request.method.toUpperCase())) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_WRITE_FREEZE,
      [context.getHandler(), context.getClass()]);
    if (allowed) return true;

    const release = this.freeze.beginWrite();
    if (!release) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('Retry-After', '30');
      throw new ServiceUnavailableException({ error: { code: 'WRITE_FROZEN',
        message: 'Hệ thống đang tạm khóa thao tác ghi để bảo trì an toàn.', details: {} } });
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      release();
    };
    const response = context.switchToHttp().getResponse<Response>();
    response.once('finish', finish);
    response.once('close', finish);
    return true;
  }
}

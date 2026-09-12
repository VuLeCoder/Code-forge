import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    this.allowedOrigins = new Set(
      config.getOrThrow<string>('FRONTEND_ORIGIN').split(',').map((origin) => origin.trim()),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (!origin || !this.allowedOrigins.has(origin)) {
      throw new ForbiddenException({
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Nguồn gửi yêu cầu không được phép.', details: {} },
      });
    }
    return true;
  }
}

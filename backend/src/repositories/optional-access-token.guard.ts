import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { ACCESS_COOKIE } from '../auth/auth.constants';

@Injectable()
export class OptionalAccessTokenGuard implements CanActivate {
  constructor(private readonly access: AccessTokenGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.cookies?.[ACCESS_COOKIE] === undefined && request.headers.authorization === undefined) {
      return true;
    }
    // Invalid/expired credentials must refresh; do not silently downgrade to anonymous.
    return this.access.canActivate(context);
  }
}

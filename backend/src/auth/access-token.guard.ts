import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { toPublicUser } from '../users/user-public';
import { ACCESS_COOKIE } from './auth.constants';
import { AuthError } from './auth-error';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>();
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const cookieToken: unknown = request.cookies?.[ACCESS_COOKIE];
    const token = (typeof cookieToken === 'string' ? cookieToken : undefined) ?? bearer;
    if (!token) throw new AuthError(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', 'Bạn cần đăng nhập.');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new AuthError(HttpStatus.UNAUTHORIZED, 'ACCESS_TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.');
    }
    if (payload.type !== 'access' || !payload.sub || !payload.sessionId) {
      throw new AuthError(HttpStatus.UNAUTHORIZED, 'ACCESS_TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.');
    }

    const user = await this.users.findById(payload.sub);
    if (!user || user.status === 'LOCKED') {
      throw new AuthError(HttpStatus.UNAUTHORIZED, 'ACCOUNT_UNAVAILABLE', 'Tài khoản không khả dụng.');
    }
    (request as AuthenticatedRequest).user = { ...toPublicUser(user), sessionId: payload.sessionId };
    return true;
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user.systemRole !== 'ADMIN' || request.user.status !== 'ACTIVE') {
      throw new ForbiddenException({ error: { code: 'ADMIN_REQUIRED', message: 'Chỉ admin đang hoạt động được dùng chức năng này.' } });
    }
    return true;
  }
}

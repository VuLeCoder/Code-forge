import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OriginGuard } from '../auth/origin.guard';
import { AdminGuard } from './admin.guard';
import { AdminController } from './admin.controller';

describe('AdminController security metadata', () => {
  it('requires an access token and active-admin authorization for every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([AccessTokenGuard, AdminGuard]);
  });

  it.each(['setUserStatus', 'setRepositoryStatus', 'restoreRepository'] as const)(
    'requires same-origin protection for the %s mutation',
    (methodName) => {
      const handler = Object.getOwnPropertyDescriptor(AdminController.prototype, methodName)?.value as object | undefined;
      if (!handler) throw new Error(`Missing ${methodName} controller handler.`);

      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([OriginGuard]);
    },
  );
});

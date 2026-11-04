import 'reflect-metadata';
import { ALLOW_DURING_WRITE_FREEZE } from '../release-control/release-write-freeze.decorator';
import { AuthController } from './auth.controller';

describe('AuthController write-freeze metadata', () => {
  it.each(['login', 'refresh', 'logout'] as const)('keeps %s available for operator access', (methodName) => {
    const handler = Object.getOwnPropertyDescriptor(AuthController.prototype, methodName)?.value as object | undefined;
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(ALLOW_DURING_WRITE_FREEZE, handler!)).toBe(true);
  });

  it('continues to block new registrations during a release freeze', () => {
    const handler = Object.getOwnPropertyDescriptor(AuthController.prototype, 'register')?.value as object | undefined;
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(ALLOW_DURING_WRITE_FREEZE, handler!)).toBeUndefined();
  });
});

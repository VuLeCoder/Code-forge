import { EventEmitter } from 'node:events';
import { ServiceUnavailableException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ReleaseWriteFreezeGuard } from './release-write-freeze.guard';
import type { ReleaseWriteFreezeService } from './release-write-freeze.service';

describe('ReleaseWriteFreezeGuard', () => {
  function makeContext(method: string) {
    const response = Object.assign(new EventEmitter(), { setHeader: jest.fn() });
    const request = { method };
    const context = {
      getType: () => 'http',
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;
    return { context, response };
  }

  it('allows reads without entering the active-write counter', () => {
    const beginWrite = jest.fn();
    const guard = new ReleaseWriteFreezeGuard({ getAllAndOverride: jest.fn() } as unknown as Reflector,
      { beginWrite } as unknown as ReleaseWriteFreezeService);

    expect(guard.canActivate(makeContext('GET').context)).toBe(true);
    expect(beginWrite).not.toHaveBeenCalled();
  });

  it('tracks an admitted mutation until the response finishes', () => {
    const release = jest.fn();
    const guard = new ReleaseWriteFreezeGuard({ getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      { beginWrite: jest.fn().mockReturnValue(release) } as unknown as ReleaseWriteFreezeService);
    const fixture = makeContext('POST');

    expect(guard.canActivate(fixture.context)).toBe(true);
    fixture.response.emit('finish');
    fixture.response.emit('close');

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns a retryable 503 while writes are frozen', () => {
    const guard = new ReleaseWriteFreezeGuard({ getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      { beginWrite: jest.fn().mockReturnValue(undefined) } as unknown as ReleaseWriteFreezeService);
    const fixture = makeContext('PATCH');

    expect(() => guard.canActivate(fixture.context)).toThrow(ServiceUnavailableException);
    expect(fixture.response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });

  it('allows the explicitly marked operator control path while frozen', () => {
    const beginWrite = jest.fn();
    const guard = new ReleaseWriteFreezeGuard({ getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector,
      { beginWrite } as unknown as ReleaseWriteFreezeService);

    expect(guard.canActivate(makeContext('PATCH').context)).toBe(true);
    expect(beginWrite).not.toHaveBeenCalled();
  });
});

import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries a transient P1001 during startup and connects once the database is available', async () => {
    jest.useFakeTimers();
    const service = new PrismaService();
    const unreachable = Object.assign(new Error('database is waking up'), { errorCode: 'P1001' });
    const connect = jest.spyOn(service, '$connect')
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce(undefined);

    const initialization = service.onModuleInit();
    await jest.advanceTimersByTimeAsync(500);

    await expect(initialization).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-connectivity startup errors', async () => {
    const service = new PrismaService();
    const invalidCredentials = Object.assign(new Error('authentication failed'), { errorCode: 'P1000' });
    const connect = jest.spyOn(service, '$connect').mockRejectedValue(invalidCredentials);

    await expect(service.onModuleInit()).rejects.toBe(invalidCredentials);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('stops retrying P1001 after four attempts and preserves the final error', async () => {
    jest.useFakeTimers();
    const service = new PrismaService();
    const unreachable = Object.assign(new Error('database is still unreachable'), { errorCode: 'P1001' });
    const connect = jest.spyOn(service, '$connect').mockRejectedValue(unreachable);

    const initialization = service.onModuleInit();
    const rejection = expect(initialization).rejects.toBe(unreachable);
    await jest.advanceTimersByTimeAsync(3_500);

    await rejection;
    expect(connect).toHaveBeenCalledTimes(4);
  });
});

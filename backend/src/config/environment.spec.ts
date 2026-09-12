import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://localhost/code_forge',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    GIT_STORAGE_PATH: '/tmp/code-forge-test',
  };

  it('converts a string port to a number', () => {
    expect(validateEnvironment({ ...validConfig, PORT: '4100' }).PORT).toBe(4100);
  });

  it('rejects a missing database URL', () => {
    expect(() =>
      validateEnvironment({
        FRONTEND_ORIGIN: validConfig.FRONTEND_ORIGIN,
        GIT_STORAGE_PATH: validConfig.GIT_STORAGE_PATH,
      }),
    ).toThrow('DATABASE_URL');
  });
});

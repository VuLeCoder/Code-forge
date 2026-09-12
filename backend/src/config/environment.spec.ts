import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://localhost/code_forge',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    GIT_STORAGE_PATH: '/tmp/code-forge-test',
    JWT_ACCESS_SECRET: 'test-secret-that-is-longer-than-32-characters',
  };

  it('converts a string port to a number', () => {
    expect(validateEnvironment({ ...validConfig, PORT: '4100' }).PORT).toBe(4100);
  });

  it('rejects a missing database URL', () => {
    expect(() =>
      validateEnvironment({
        FRONTEND_ORIGIN: validConfig.FRONTEND_ORIGIN,
        GIT_STORAGE_PATH: validConfig.GIT_STORAGE_PATH,
        JWT_ACCESS_SECRET: validConfig.JWT_ACCESS_SECRET,
      }),
    ).toThrow('DATABASE_URL');
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnvironment({ ...validConfig, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      'JWT_ACCESS_SECRET',
    );
  });

  it('requires secure cookies when SameSite is none', () => {
    expect(() => validateEnvironment({ ...validConfig, COOKIE_SAME_SITE: 'none' })).toThrow(
      'COOKIE_SECURE=true',
    );
  });
});

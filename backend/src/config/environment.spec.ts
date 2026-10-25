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

  it('validates repository quota and retention settings', () => {
    const defaults = validateEnvironment(validConfig);
    expect(defaults.MAX_REPOSITORIES_PER_USER).toBe(20);
    expect(defaults.MAX_REPOSITORY_BYTES).toBe(500 * 1024 * 1024);
    expect(defaults.MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(defaults.MAX_PUSH_BYTES).toBe(100 * 1024 * 1024);
    expect(defaults.SOFT_DELETE_RETENTION_DAYS).toBe(30);
    expect(validateEnvironment({ ...validConfig, MAX_REPOSITORIES_PER_USER: '4' }).MAX_REPOSITORIES_PER_USER).toBe(4);
    expect(() => validateEnvironment({ ...validConfig, MAX_REPOSITORIES_PER_USER: '0' })).toThrow('MAX_REPOSITORIES_PER_USER');
    expect(() => validateEnvironment({ ...validConfig, SOFT_DELETE_RETENTION_DAYS: '-1' })).toThrow('SOFT_DELETE_RETENTION_DAYS');
    expect(() => validateEnvironment({ ...validConfig, MAX_PUSH_BYTES: '0' })).toThrow('MAX_PUSH_BYTES');
    expect(() => validateEnvironment({ ...validConfig, MAX_REPOSITORY_BYTES: '100', MAX_FILE_BYTES: '101' })).toThrow('MAX_FILE_BYTES');
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnvironment({ ...validConfig, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      'JWT_ACCESS_SECRET',
    );
  });

  it('defaults proxy trust to zero and validates an explicit hop count', () => {
    expect(validateEnvironment(validConfig).TRUST_PROXY_HOPS).toBe(0);
    expect(validateEnvironment({ ...validConfig, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
    expect(() => validateEnvironment({ ...validConfig, TRUST_PROXY_HOPS: '-1' })).toThrow('TRUST_PROXY_HOPS');
    expect(() => validateEnvironment({ ...validConfig, TRUST_PROXY_HOPS: '11' })).toThrow('TRUST_PROXY_HOPS');
    expect(() => validateEnvironment({ ...validConfig, TRUST_PROXY_HOPS: '1.5' })).toThrow('TRUST_PROXY_HOPS');
  });

  it('requires a sufficiently strong signed proxy secret only in production', () => {
    expect(() => validateEnvironment({ ...validConfig, NODE_ENV: 'production' })).toThrow('RATE_LIMIT_PROXY_SECRET');
    expect(() => validateEnvironment({ ...validConfig, RATE_LIMIT_PROXY_SECRET: 'too-short' })).toThrow('RATE_LIMIT_PROXY_SECRET');
    expect(validateEnvironment({ ...validConfig, DATABASE_URL_UNPOOLED: validConfig.DATABASE_URL, COOKIE_SECURE: true,
      NODE_ENV: 'production', RATE_LIMIT_PROXY_SECRET: 'x'.repeat(32) }).RATE_LIMIT_PROXY_SECRET)
      .toBe('x'.repeat(32));
  });

  it('requires secure cookies in production while allowing local and test defaults', () => {
    const production = { ...validConfig, DATABASE_URL_UNPOOLED: validConfig.DATABASE_URL,
      NODE_ENV: 'production', RATE_LIMIT_PROXY_SECRET: 'x'.repeat(32) };
    expect(validateEnvironment(validConfig).COOKIE_SECURE).toBe(false);
    expect(() => validateEnvironment(production)).toThrow('COOKIE_SECURE=true');
    expect(validateEnvironment({ ...production, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('requires secure cookies when SameSite is none', () => {
    expect(() => validateEnvironment({ ...validConfig, COOKIE_SAME_SITE: 'none' })).toThrow(
      'COOKIE_SECURE=true',
    );
  });
});

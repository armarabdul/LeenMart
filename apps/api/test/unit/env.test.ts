import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/shared/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
} satisfies NodeJS.ProcessEnv;

describe('environment configuration', () => {
  beforeEach(() => {
    resetEnvCache();
  });

  it('applies defaults for optional variables', () => {
    const env = loadEnv({ ...validEnv });
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SERVICE_NAME).toBe('leen-mart-api');
  });

  it('coerces numeric variables from strings', () => {
    const env = loadEnv({ ...validEnv, PORT: '8080', RATE_LIMIT_MAX: '250' });
    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_MAX).toBe(250);
  });

  it('parses the CORS allowlist into a trimmed array', () => {
    const env = loadEnv({
      ...validEnv,
      CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example ,',
    });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('refuses to boot without a database URL', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = validEnv;
    expect(() => loadEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('reports every failing variable at once rather than one per restart', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadEnv({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('forbids pretty logging in production', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        LOG_PRETTY: 'true',
        CORS_ALLOWED_ORIGINS: 'https://leenmart.in',
      }),
    ).toThrow(/LOG_PRETTY/);
  });

  it('forbids localhost as a production CORS origin', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://leenmart.in,http://localhost:5173',
      }),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it('memoises the parsed environment', () => {
    expect(loadEnv({ ...validEnv })).toBe(loadEnv({ ...validEnv, PORT: '9999' }));
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/shared/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
} satisfies NodeJS.ProcessEnv;

/**
 * A production environment that satisfies every guard. Individual tests break
 * one field at a time, so each failure is unambiguous about what caused it.
 */
const productionEnv = {
  ...validEnv,
  NODE_ENV: 'production',
  CORS_ALLOWED_ORIGINS: 'https://leenmart.in',
  JWT_ACCESS_SECRET: 'a-real-production-secret-that-is-long-enough',
  MFA_ENCRYPTION_KEY: 'f'.repeat(64),
  KYC_USE_DEV_DATA_KEY_CIPHER: 'false',
  KYC_KMS_KEY_ID: 'arn:aws:kms:ap-south-1:000000000000:key/real',
  KYC_S3_SECRET_ACCESS_KEY: 'a-real-object-storage-secret',
  KYC_FINGERPRINT_PEPPER: '9'.repeat(64),
  PRODUCT_MEDIA_S3_SECRET_ACCESS_KEY: 'a-real-product-media-secret',
  // S4-QR: a real Ed25519 keypair, distinct from the insecure dev default —
  // any keypair satisfies the production guard, which only rejects the one
  // hardcoded dev value (env.ts's own `superRefine`).
  PICKUP_TOKEN_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIGrBPIHa/5ie/GfsGx27+SEDU8ClHf0QhPav0JfREclD\n-----END PRIVATE KEY-----\n',
  PICKUP_TOKEN_PUBLIC_KEY:
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAENRBVQ4HPHnaCUWzQxEMdJYE7bOQCMb3vDyt8tweJwc=\n-----END PUBLIC KEY-----\n',
  APP_DATABASE_URL: 'postgresql://leenmart_app:secret@db:5432/leenmart?schema=public',
  ADMIN_DATABASE_URL: 'postgresql://leenmart_admin:secret@db:5432/leenmart?schema=public',
  PUBLIC_DATABASE_URL: 'postgresql://leenmart_public:secret@db:5432/leenmart?schema=public',
  CHECKOUT_DATABASE_URL: 'postgresql://leenmart_checkout:secret@db:5432/leenmart?schema=public',
};

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

  it('defaults the access-token lifetime to SDD 7.2’s 10 minutes', () => {
    // Pinned rather than incidental: an access token cannot be retracted
    // mid-life, so this value is the revocation lag the whole token design is
    // sized against (SDD 7.2).
    expect(loadEnv({ ...validEnv }).JWT_ACCESS_TTL_SECONDS).toBe(600);
  });

  it('defaults the refresh-token lifetime to SDD 7.2’s 30 days', () => {
    expect(loadEnv({ ...validEnv }).JWT_REFRESH_TTL_DAYS).toBe(30);
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

  it('applies the insecure MFA_ENCRYPTION_KEY default outside production', () => {
    const env = loadEnv({ ...validEnv });
    expect(env.MFA_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an MFA_ENCRYPTION_KEY that is not 64 hex characters', () => {
    expect(() => loadEnv({ ...validEnv, MFA_ENCRYPTION_KEY: 'not-hex-and-too-short' })).toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it('rejects an MFA_ENCRYPTION_KEY of the right length but non-hex characters', () => {
    expect(() => loadEnv({ ...validEnv, MFA_ENCRYPTION_KEY: 'z'.repeat(64) })).toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it('forbids the insecure default MFA_ENCRYPTION_KEY in production', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://leenmart.in',
        JWT_ACCESS_SECRET: 'a-real-production-secret-that-is-long-enough',
      }),
    ).toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('accepts a real MFA_ENCRYPTION_KEY in production', () => {
    const env = loadEnv({ ...productionEnv, MFA_ENCRYPTION_KEY: 'f'.repeat(64) });
    expect(env.MFA_ENCRYPTION_KEY).toBe('f'.repeat(64));
  });

  describe('KYC object storage and encryption (SDD 12.1/12.3)', () => {
    it('defaults to MinIO and the development cipher outside production', () => {
      const env = loadEnv({ ...validEnv });

      expect(env.KYC_S3_ENDPOINT).toBe('http://localhost:9000');
      expect(env.KYC_S3_BUCKET).toBe('leenmart-private-kyc');
      expect(env.KYC_USE_DEV_DATA_KEY_CIPHER).toBe(true);
    });

    it('gives the KYC wrapping key a value distinct from MFA_ENCRYPTION_KEY', () => {
      // SDD 12.1/12.3 scope KYC key material to its own CMK; sharing the MFA
      // key would make one compromise reach both.
      const env = loadEnv({ ...validEnv });

      expect(env.KYC_DEV_WRAPPING_KEY).not.toBe(env.MFA_ENCRYPTION_KEY);
    });

    it('rejects a KYC wrapping key that is not 64 hex characters', () => {
      expect(() => loadEnv({ ...validEnv, KYC_DEV_WRAPPING_KEY: 'z'.repeat(64) })).toThrow(
        /KYC_DEV_WRAPPING_KEY/,
      );
    });

    it('refuses the development cipher in production', () => {
      expect(() => loadEnv({ ...productionEnv, KYC_USE_DEV_DATA_KEY_CIPHER: 'true' })).toThrow(
        /KYC_USE_DEV_DATA_KEY_CIPHER/,
      );
    });

    it('requires a KMS CMK in production', () => {
      const { KYC_KMS_KEY_ID: _omitted, ...withoutCmk } = productionEnv;

      expect(() => loadEnv(withoutCmk)).toThrow(/KYC_KMS_KEY_ID/);
    });

    it('refuses the development object-storage secret in production', () => {
      expect(() =>
        loadEnv({ ...productionEnv, KYC_S3_SECRET_ACCESS_KEY: 'leenmart-dev-secret' }),
      ).toThrow(/KYC_S3_SECRET_ACCESS_KEY/);
    });

    it('refuses the development product-media object-storage secret in production (S2-6a)', () => {
      expect(() =>
        loadEnv({ ...productionEnv, PRODUCT_MEDIA_S3_SECRET_ACCESS_KEY: 'leenmart-dev-secret' }),
      ).toThrow(/PRODUCT_MEDIA_S3_SECRET_ACCESS_KEY/);
    });

    it('accepts a fully configured production environment', () => {
      const env = loadEnv({ ...productionEnv });

      expect(env.KYC_USE_DEV_DATA_KEY_CIPHER).toBe(false);
      expect(env.KYC_KMS_KEY_ID).toBe('arn:aws:kms:ap-south-1:000000000000:key/real');
    });
  });

  describe('runtime database roles (KYC-2B-1)', () => {
    it('falls back to the owner connection outside production', () => {
      // So a developer who has not run `db:provision-roles` still gets a
      // working `pnpm dev` rather than a startup failure.
      const env = loadEnv({ ...validEnv });

      expect(env.APP_DATABASE_URL).toBeUndefined();
      expect(env.ADMIN_DATABASE_URL).toBeUndefined();
      expect(env.PUBLIC_DATABASE_URL).toBeUndefined();
      expect(env.CHECKOUT_DATABASE_URL).toBeUndefined();
    });

    it.each([
      'APP_DATABASE_URL',
      'ADMIN_DATABASE_URL',
      'PUBLIC_DATABASE_URL',
      'CHECKOUT_DATABASE_URL',
    ] as const)('requires %s in production', (variable) => {
      // In production that fallback is the whole vulnerability: the owner
      // role is SUPERUSER/BYPASSRLS, so every future policy would be skipped
      // and nothing would report it.
      const withoutRole: NodeJS.ProcessEnv = { ...productionEnv };
      delete withoutRole[variable];

      expect(() => loadEnv(withoutRole)).toThrow(new RegExp(variable));
    });

    it.each([
      'APP_DATABASE_URL',
      'ADMIN_DATABASE_URL',
      'PUBLIC_DATABASE_URL',
      'CHECKOUT_DATABASE_URL',
    ])('refuses %s when it is merely a copy of the owner connection', (variable) => {
      // The likeliest way to satisfy the check above without separating
      // anything at all.
      expect(() => loadEnv({ ...productionEnv, [variable]: productionEnv.DATABASE_URL })).toThrow(
        new RegExp(variable),
      );
    });

    it('accepts distinct runtime connections in production', () => {
      const env = loadEnv({ ...productionEnv });

      expect(env.APP_DATABASE_URL).not.toBe(env.DATABASE_URL);
      expect(env.ADMIN_DATABASE_URL).not.toBe(env.APP_DATABASE_URL);
      expect(env.PUBLIC_DATABASE_URL).not.toBe(env.DATABASE_URL);
      expect(env.CHECKOUT_DATABASE_URL).not.toBe(env.DATABASE_URL);
    });
  });

  describe('KYC duplicate detection (SEC-17)', () => {
    it('defaults the fingerprint pepper outside production', () => {
      expect(loadEnv({ ...validEnv }).KYC_FINGERPRINT_PEPPER).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refuses the development pepper in production', () => {
      // A known pepper makes every stored PAN fingerprint enumerable offline,
      // which is the entire reason the fingerprint is keyed at all.
      const { KYC_FINGERPRINT_PEPPER: _omitted, ...withDefaultPepper } = productionEnv;

      expect(() => loadEnv(withDefaultPepper)).toThrow(/KYC_FINGERPRINT_PEPPER/);
    });

    it('requires 32 bytes of hex', () => {
      expect(() => loadEnv({ ...validEnv, KYC_FINGERPRINT_PEPPER: 'too-short' })).toThrow(
        /KYC_FINGERPRINT_PEPPER/,
      );
    });

    it('is a different secret from the MFA key and the KYC wrapping key', () => {
      // Sharing any of them would make one leak defeat two unrelated controls.
      const env = loadEnv({ ...validEnv });

      expect(env.KYC_FINGERPRINT_PEPPER).not.toBe(env.MFA_ENCRYPTION_KEY);
      expect(env.KYC_FINGERPRINT_PEPPER).not.toBe(env.KYC_DEV_WRAPPING_KEY);
      expect(env.KYC_FINGERPRINT_PEPPER).not.toBe(env.JWT_ACCESS_SECRET);
    });
  });

  it('memoises the parsed environment', () => {
    expect(loadEnv({ ...validEnv })).toBe(loadEnv({ ...validEnv, PORT: '9999' }));
  });
});

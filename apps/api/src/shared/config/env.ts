import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment configuration, validated at process start (SDD 20.4).
 *
 * The service refuses to boot on an invalid or missing variable. This turns a
 * 3 a.m. production mystery ("why is it writing to the wrong bucket?") into a
 * deployment failure with a precise message.
 */
loadDotenv({ path: process.env.ENV_FILE ?? '.env' });

const nodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);

const booleanFromString = z
  .string()
  .transform((value) => value.toLowerCase() === 'true' || value === '1');

/**
 * Dev/test-only placeholder so the service boots without extra setup outside
 * production. `superRefine` below refuses to let this value reach prod.
 */
const INSECURE_DEV_JWT_ACCESS_SECRET = 'dev-only-insecure-jwt-access-secret-change-me-please';

/**
 * Same purpose as `INSECURE_DEV_JWT_ACCESS_SECRET`, but must itself be a
 * valid 64-character hex string (32 bytes) — the schema below has no
 * separate escape hatch for a human-readable placeholder, since the value
 * has to decode to a real AES-256-GCM key even in development.
 */
const INSECURE_DEV_MFA_ENCRYPTION_KEY = 'deadbeef'.repeat(8);

/**
 * The development wrapping key for `DevDataKeyCipher`, the local stand-in for
 * KMS. Same shape and same rules as `INSECURE_DEV_MFA_ENCRYPTION_KEY` — and
 * deliberately a *separate* value, because SDD 12.1/12.3 scope KYC key
 * material to its own KMS-managed CMK and reusing the MFA key would quietly
 * make one compromise reach both.
 */
const INSECURE_DEV_KYC_WRAPPING_KEY = 'feedface'.repeat(8);

const envSchema = z
  .object({
    // --- runtime ---
    NODE_ENV: nodeEnvSchema.default('development'),
    SERVICE_NAME: z.string().min(1).default('leen-mart-api'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    BODY_LIMIT: z.string().default('1mb'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),

    // --- observability ---
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanFromString.default('false'),

    // --- data stores ---
    DATABASE_URL: z.string().url().startsWith('postgres'),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(100).default(10),
    REDIS_URL: z.string().url().startsWith('redis'),

    // --- http ---
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1_000),

    // --- identity (SDD 6.1: JWT access tokens, opaque hashed refresh tokens) ---
    JWT_ACCESS_SECRET: z.string().min(32).default(INSECURE_DEV_JWT_ACCESS_SECRET),
    /**
     * 10 minutes, per SDD 7.2's token table. Load-bearing rather than
     * arbitrary: an access token is a bearer credential that no server-side
     * check can retract mid-life, so its lifetime *is* the revocation lag —
     * SDD 7.2 sizes the planned denylist as "a TTL equal to the remaining
     * access-token life (max 10 minutes of exposure)". A longer default
     * silently widens that window everywhere it is not overridden.
     */
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    /**
     * SDD 7.2's `aud` claim, verified on every access token. Defaults to the
     * service's own name because that is precisely what the claim asserts —
     * the token was minted for *this* API. Set explicitly once a second
     * audience exists, so one service's tokens cannot be replayed at another.
     */
    JWT_AUDIENCE: z.string().min(1).default('leen-mart-api'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /**
     * SDD 7.5's admin-console "30-minute idle timeout", expressed as the
     * sliding window an admin refresh token gets instead of
     * `JWT_REFRESH_TTL_DAYS`. Because SDD 7.2 already makes refresh tokens
     * sliding, a short window *is* an idle timeout: every rotation restarts
     * it, so an admin who keeps working stays signed in and one who stops for
     * this long has to re-authenticate with password and TOTP.
     */
    ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),

    // --- identity (Milestone 3 Step 5C: AES-256-GCM encryption for admin MFA secrets) ---
    MFA_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'must be a 64-character hexadecimal string (32 bytes)')
      .default(INSECURE_DEV_MFA_ENCRYPTION_KEY),

    // --- KYC object storage (SDD 12.1/12.2): S3-compatible, MinIO locally, R2 in production ---
    KYC_S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    KYC_S3_REGION: z.string().min(1).default('auto'),
    KYC_S3_BUCKET: z.string().min(1).default('leenmart-private-kyc'),
    KYC_S3_ACCESS_KEY_ID: z.string().min(1).default('leenmart'),
    KYC_S3_SECRET_ACCESS_KEY: z.string().min(1).default('leenmart-dev-secret'),
    /**
     * MinIO needs path-style addressing (`endpoint/bucket/key`); R2 accepts it
     * too, so this defaults on and is not something production has to think
     * about.
     */
    KYC_S3_FORCE_PATH_STYLE: booleanFromString.default('true'),

    // --- KYC envelope encryption (SDD 12.1/12.3) ---
    /**
     * The KMS CMK that wraps every KYC data key. No default: there is no
     * sensible stand-in for a CMK, and production is refused below without it.
     */
    KYC_KMS_KEY_ID: z.string().min(1).optional(),
    KYC_KMS_REGION: z.string().min(1).default('ap-south-1'),
    /**
     * Development only. Selects `DevDataKeyCipher` over the KMS adapter; the
     * `superRefine` below refuses it in production, and the cipher itself
     * refuses to construct there as a second, independent guard.
     */
    KYC_USE_DEV_DATA_KEY_CIPHER: booleanFromString.default('true'),
    KYC_DEV_WRAPPING_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'must be a 64-character hexadecimal string (32 bytes)')
      .default(INSECURE_DEV_KYC_WRAPPING_KEY),
  })
  .superRefine((env, ctx) => {
    // Guard rails that only apply once real users are involved.
    if (env.NODE_ENV === 'production') {
      if (env.LOG_PRETTY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_PRETTY'],
          message: 'Pretty logging must be disabled in production: logs are consumed as JSON.',
        });
      }
      if (env.CORS_ALLOWED_ORIGINS.some((origin) => origin.includes('localhost'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ALLOWED_ORIGINS'],
          message: 'localhost must not be an allowed CORS origin in production.',
        });
      }
      if (env.JWT_ACCESS_SECRET === INSECURE_DEV_JWT_ACCESS_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'A real JWT_ACCESS_SECRET must be set in production.',
        });
      }
      if (env.MFA_ENCRYPTION_KEY === INSECURE_DEV_MFA_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MFA_ENCRYPTION_KEY'],
          message: 'A real MFA_ENCRYPTION_KEY must be set in production.',
        });
      }
      if (env.KYC_USE_DEV_DATA_KEY_CIPHER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KYC_USE_DEV_DATA_KEY_CIPHER'],
          message:
            'KYC key wrapping must use the KMS-managed CMK in production (SDD 12.1/12.3), never the development cipher.',
        });
      }
      if (!env.KYC_KMS_KEY_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KYC_KMS_KEY_ID'],
          message: 'A KMS CMK must be configured in production to wrap KYC data keys (SDD 12.3).',
        });
      }
      if (env.KYC_S3_SECRET_ACCESS_KEY === 'leenmart-dev-secret') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KYC_S3_SECRET_ACCESS_KEY'],
          message: 'Real object-storage credentials must be set in production.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses and caches the environment.
 *
 * Throws with every failing variable listed at once, rather than one per
 * restart.
 */
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
};

/** Test-only: clears the memoised environment between cases. */
export const resetEnvCache = (): void => {
  cached = undefined;
};

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
export const isDevelopment = (env: Env): boolean => env.NODE_ENV === 'development';

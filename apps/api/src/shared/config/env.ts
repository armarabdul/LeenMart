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
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    // --- identity (Milestone 3 Step 5C: AES-256-GCM encryption for admin MFA secrets) ---
    MFA_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'must be a 64-character hexadecimal string (32 bytes)')
      .default(INSECURE_DEV_MFA_ENCRYPTION_KEY),
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

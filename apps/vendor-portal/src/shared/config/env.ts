import { z } from 'zod';

/**
 * Frontend environment configuration — mirrors `customer-pwa`'s own `env.ts`
 * exactly (same validation discipline, same "nothing here may be a secret"
 * rule).
 */
const envSchema = z.object({
  VITE_API_BASE_URL: z.string().min(1).default('/api/v1'),
  VITE_APP_NAME: z.string().min(1).default('Leen Mart Vendor Portal'),
  VITE_APP_VERSION: z.string().min(1).default('0.1.0'),
  VITE_ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).default('development'),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid frontend environment configuration:\n${issues}`);
}

export const env = {
  apiBaseUrl: parsed.data.VITE_API_BASE_URL,
  appName: parsed.data.VITE_APP_NAME,
  appVersion: parsed.data.VITE_APP_VERSION,
  environment: parsed.data.VITE_ENVIRONMENT,
  isProduction: parsed.data.VITE_ENVIRONMENT === 'production',
} as const;

export type AppEnv = typeof env;

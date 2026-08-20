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
  /**
   * The Ed25519 public half of `PICKUP_TOKEN_PRIVATE_KEY`/`PICKUP_TOKEN_PUBLIC_KEY`
   * (S4-QR, backend `env.ts`) — safe to ship in a JS bundle, since a public
   * key can verify but never sign (S4-QR-FALLBACK's offline local
   * verification needs it in the browser; the private key never leaves the
   * API). Defaults to the identical insecure dev keypair the backend
   * defaults to, so local dev works without extra configuration; a real
   * deployment must set this to match whatever `PICKUP_TOKEN_PUBLIC_KEY` the
   * API is actually configured with.
   */
  VITE_PICKUP_TOKEN_PUBLIC_KEY: z
    .string()
    .min(1)
    .default(
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAQADYhCP8GEfDElt7kbLWxtRx0B6odWvdhpLp5m2xI8k=\n-----END PUBLIC KEY-----\n',
    ),
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
  pickupTokenPublicKey: parsed.data.VITE_PICKUP_TOKEN_PUBLIC_KEY,
} as const;

export type AppEnv = typeof env;

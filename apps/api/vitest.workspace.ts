import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['test/unit/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      environment: 'node',
      include: ['test/integration/**/*.test.ts'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
      /**
       * The one place `ENV_FILE` can actually redirect
       * `src/shared/config/env.ts` at `.env.test`.
       *
       * That module calls `dotenv.config({ path: process.env.ENV_FILE ?? '.env' })`
       * as a **module-level side effect**, which fires the first time anything
       * imports it — and Vitest imports every integration test file's own
       * `import { createContainer } from '../../src/container.js'` during
       * *collection*, before any file's `beforeAll` has run. Setting
       * `process.env.ENV_FILE = '.env.test'` inside a test's own `beforeAll`
       * (as several integration tests still do, for local readability) is
       * therefore always too late: `env.ts` has already loaded `.env` — the
       * *development* database — by then, `dotenv`'s default `override: false`
       * means a later `dotenv.config({ path: '.env.test' })` call cannot
       * unwind that, and `loadEnv()`'s own module-level cache freezes the
       * parsed result for the rest of the process regardless.
       *
       * Vitest's `env` option is applied to `process.env` before a project's
       * files are collected, which is early enough. This is exactly the
       * mechanism CI already relies on (`.github/workflows/ci.yml` sets
       * `ENV_FILE: .env.test` as a real shell environment variable before
       * `pnpm test:integration` starts) — this makes a bare
       * `vitest run --project integration`, or a single file run directly
       * (`vitest run test/integration/foo.test.ts`), safe the same way,
       * without depending on the invoking shell to have exported it first.
       */
      env: { ENV_FILE: '.env.test' },
    },
  },
]);

import { defineConfig } from 'vitest/config';

/**
 * Two projects, deliberately separated (SDD 24.5).
 *
 * `unit` is fast, pure, and runs on every save and in the pre-push hook.
 * `integration` needs real PostgreSQL and Redis from docker compose, because
 * the locking and constraint behaviour the platform depends on does not exist
 * in a mock — mocking it would test a fiction.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Both process entry points: bootstrap and signal handling, exercised by
      // running the process rather than by a test (S2-6b adds `worker.ts`).
      exclude: ['src/server.ts', 'src/worker.ts', 'src/**/*.d.ts'],
    },
  },
});

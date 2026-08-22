import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../../src/container.js';

/**
 * A guard against exactly the failure this repository already had once:
 * `src/shared/config/env.ts` loads `.env` (development) as a **module-level
 * side effect** the first time anything imports it, and that import happens
 * during Vitest's file-collection pass — before any test file's own
 * `beforeAll` runs. A test that sets `process.env.ENV_FILE = '.env.test'`
 * inside its own `beforeAll` is therefore not the thing that actually
 * redirects the database; `vitest.workspace.ts`'s `integration` project
 * `env: { ENV_FILE: '.env.test' }` is (see that file's own comment). If that
 * config is ever removed or narrowed, every integration test's real
 * `createContainer()` calls silently start writing to the *development*
 * database and Redis instead of `leenmart_test` — a data-safety incident,
 * not just a test failure — with no other test that would catch it.
 *
 * This asserts the one fact that distinguishes the two: `.env` sets
 * `NODE_ENV=development` and `.env.test` sets `NODE_ENV=test`, and the two
 * databases' names differ by the same `_test` suffix `.env.test`'s
 * `DATABASE_URL` carries. `container.env` is exactly what every other
 * integration test's own `createContainer()` call receives, so this proves
 * the same environment every other test's real database/Redis I/O runs on.
 */
describe('integration test environment isolation', () => {
  let container: Container;

  beforeAll(() => {
    container = createContainer();
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('resolves NODE_ENV=test, never development', () => {
    expect(container.env.NODE_ENV).toBe('test');
  });

  it('resolves a *_test database, never the development database', () => {
    expect(container.env.DATABASE_URL).toMatch(/leenmart_test(\?|$)/);
    expect(container.env.DATABASE_URL).not.toBe(
      'postgresql://leenmart:leenmart@localhost:5432/leenmart?schema=public',
    );
  });

  it('resolves Redis db 1, the same isolation CI configures for it', () => {
    expect(container.env.REDIS_URL).toMatch(/\/1$/);
  });
});

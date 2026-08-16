import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

/**
 * @testing-library/jest-dom@6's own `vitest.d.ts` augments `declare module
 * 'vitest'`, but this project's vitest (2.x) only re-exports `Assertion` from
 * `@vitest/expect` rather than declaring it locally — a re-export is not a
 * mergeable declaration, so that augmentation lands on a module TypeScript
 * never actually uses and silently has no effect. Augmenting `@vitest/expect`
 * directly (jest-dom's own matcher types, retargeted to the module vitest 2.x
 * actually sources `Assertion` from) is the fix.
 */
declare module '@vitest/expect' {
  // An empty body is the correct shape for a declaration-merging augmentation:
  // the interface's members come entirely from `extends`.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}

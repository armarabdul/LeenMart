import tseslint from 'typescript-eslint';
import reactConfig from '@leen-mart/config/eslint/react';

export default [
  ...reactConfig,
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    // Type-aware linting scoped to `src/`/`test/` — the same files
    // `tsconfig.json` actually includes.
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // `vitest.config.ts` is deliberately excluded from `tsconfig.json`
    // (see that file's own comment) — this workspace's `vitest`
    // installation pulls in its own internal `vite` peer
    // (`vite-node`/`@vitest/mocker`) at a different major version than the
    // `vite` this package pins directly for `@vitejs/plugin-react`, and
    // type-checking the file's `plugins: [react()]` line against both
    // simultaneously is a real, unrelated type clash, not a mistake in the
    // file.
    //
    // `parserOptions.projectService.allowDefaultProject` (typescript-eslint's
    // own suggested fix, named in the parser error itself) was tried first
    // and does not actually work here — glob matching against
    // `allowDefaultProject` is unreliable for exactly this shape of case
    // (upstream: typescript-eslint/typescript-eslint#9739, #9674, #9715,
    // all still open). `disableTypeChecked` is the mechanism this same base
    // config already uses for `.js`/`.cjs`/`.mjs` files (see
    // `@leen-mart/config/eslint/base.js`) — proven to work, not a new
    // pattern introduced for this one file. It turns off type-aware rules
    // for this file only; every plain syntax/style rule still runs, so the
    // file is genuinely linted, not skipped.
    // `**/vitest.config.ts`, not the bare filename: lint-staged invokes
    // ESLint from the repo root against this file's root-relative path
    // (packages/ui/vitest.config.ts), while `pnpm lint` invokes it with
    // this package as CWD (bare vitest.config.ts). A pattern anchored to
    // one CWD silently fails to match under the other -- confirmed with
    // `eslint --print-config`, which is what surfaced this the first time.
    files: ['**/vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
];

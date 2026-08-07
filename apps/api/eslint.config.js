import nodeConfig from '@leen-mart/config/eslint/node';

export default [
  ...nodeConfig,
  { ignores: ['dist/**', 'prisma/generated/**'] },
  {
    // Point type-aware linting at a concrete project rather than relying on
    // project discovery. Restricted to TS files so the `disableTypeChecked`
    // block in the base preset still governs plain .js config files.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The composition root is the one place allowed to reach across every
    // layer: wiring adapters to ports is precisely its job.
    files: ['src/container.ts', 'src/server.ts', 'src/app.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

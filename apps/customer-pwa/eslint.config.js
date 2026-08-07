import reactConfig from '@leen-mart/config/eslint/react';

export default [
  ...reactConfig,
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },
  {
    // tsconfig.json is solution-style (references only), so type-aware linting
    // is pointed at the two leaf projects explicitly.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['vite.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

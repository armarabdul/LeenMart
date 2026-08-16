import reactConfig from '@leen-mart/config/eslint/react';

export default [
  ...reactConfig,
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },
  {
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

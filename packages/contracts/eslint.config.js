import nodeConfig from '@leen-mart/config/eslint/node';

export default [
  ...nodeConfig,
  { ignores: ['dist/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];

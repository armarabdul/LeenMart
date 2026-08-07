import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { baseConfig } from './base.js';

/**
 * React + Vite preset.
 *
 * The `no-restricted-imports` block mirrors SDD 25.3: a feature may import from
 * `shared/`, never from another feature. Cross-feature needs get lifted into
 * `shared/` or composed at the page level.
 */
export const reactConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/features/*/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/*/**'],
              message:
                'A feature may not import from another feature (SDD 25.3). Lift shared code into src/shared or compose at the page level.',
            },
          ],
        },
      ],
    },
  },
];

export default reactConfig;

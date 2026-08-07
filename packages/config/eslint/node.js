import globals from 'globals';
import { baseConfig } from './base.js';

/**
 * Node/Express preset.
 *
 * The `no-restricted-imports` block is the machine-enforced Clean Architecture
 * dependency rule from SDD 24.4. Dependencies point inward only; a violation
 * fails the build rather than relying on a reviewer noticing it.
 */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // domain/ is the innermost layer: it may import nothing outside domain/.
    files: ['**/modules/*/domain/**/*.ts', '**/shared/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/application/**',
                '**/infrastructure/**',
                '**/interface/**',
                'express',
                'express-*',
                '@prisma/*',
                'prisma',
                'ioredis',
                'pino',
                'pino-*',
                'axios',
                'node:fs',
                'node:http',
                'fs',
                'http',
              ],
              message:
                'Dependency rule violation (SDD 2.3): the domain layer must not depend on outer layers, frameworks or I/O.',
            },
          ],
        },
      ],
    },
  },
  {
    // application/ orchestrates the domain; it must not know about frameworks
    // or concrete adapters. It talks to the outside world through ports only.
    files: ['**/modules/*/application/**/*.ts', '**/shared/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/infrastructure/**',
                '**/interface/**',
                'express',
                'express-*',
                '@prisma/*',
                'prisma',
                'ioredis',
              ],
              message:
                'Dependency rule violation (SDD 2.3): the application layer may depend on the domain and on ports, never on adapters or the HTTP framework.',
            },
          ],
        },
      ],
    },
  },
  {
    // Modules are only reachable through their published interface (index.ts).
    // Tests are excluded as they inherently require white-box access to the module internals they are verifying.
    files: ['**/modules/**/*.ts'],
    ignores: ['**/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/domain/**', '**/modules/*/application/**'],
              message:
                'Cross-module access must go through the module index.ts published interface (SDD 5.1).',
            },
          ],
        },
      ],
    },
  },
];

export default nodeConfig;

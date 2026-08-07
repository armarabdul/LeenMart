import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['test/unit/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      environment: 'node',
      include: ['test/integration/**/*.test.ts'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  },
]);

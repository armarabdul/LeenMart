import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Mirrors both apps' own `vite.config.ts`: `defineConfig` from `'vite'`
// itself, not `'vitest/config'` — the latter's type augmentation is what
// triggers a cross-version `Plugin`/`UserConfig` mismatch in this workspace
// (two `vite` majors resolve simultaneously via unrelated transitive peers),
// which this package has no vite.config.ts of its own to otherwise avoid.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
});

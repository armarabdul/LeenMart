import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Leen Mart',
          short_name: 'Leen Mart',
          description: 'Hyperlocal multi-vendor marketplace',
          theme_color: '#0f766e',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // App shell only. Authenticated API responses are never cached:
          // a service-worker cache survives logout and leaks data on a shared
          // device (SDD 23.1, SEC-14).
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/cdn\..*\.(?:png|jpg|jpeg|svg|webp|avif)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'product-media',
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    preview: { port: 5173, strictPort: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      // Enforces the initial-bundle budget from SDD 21.5 / PERF-11.
      chunkSizeWarningLimit: 200,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            redux: ['@reduxjs/toolkit', 'react-redux'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});

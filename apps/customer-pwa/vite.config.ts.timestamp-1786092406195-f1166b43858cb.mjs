// vite.config.ts
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "file:///C:/Users/Home/Downloads/leen-mart/node_modules/.pnpm/vite@6.0.7_@types+node@22.10.5_jiti@2.6.1_terser@5.49.2_tsx@4.19.2_yaml@2.9.0/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Home/Downloads/leen-mart/node_modules/.pnpm/@vitejs+plugin-react@4.3.4_vite@6.0.7_@types+node@22.10.5_jiti@2.6.1_terser@5.49.2_tsx@4.19.2_yaml@2.9.0_/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { VitePWA } from "file:///C:/Users/Home/Downloads/leen-mart/node_modules/.pnpm/vite-plugin-pwa@0.21.1_vite@6.0.7_@types+node@22.10.5_jiti@2.6.1_terser@5.49.2_tsx@4.19.2_yam_3lxgo3rbcu32nibjdga2fow7fa/node_modules/vite-plugin-pwa/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///C:/Users/Home/Downloads/leen-mart/apps/customer-pwa/vite.config.ts";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon.svg"],
        manifest: {
          name: "Leen Mart",
          short_name: "Leen Mart",
          description: "Hyperlocal multi-vendor marketplace",
          theme_color: "#0f766e",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable"
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // App shell only. Authenticated API responses are never cached:
          // a service-worker cache survives logout and leaks data on a shared
          // device (SDD 23.1, SEC-14).
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/cdn\..*\.(?:png|jpg|jpeg|svg|webp|avif)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "product-media",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }
              }
            }
          ]
        },
        devOptions: { enabled: false }
      })
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
      }
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET ?? "http://localhost:4000",
          changeOrigin: true
        }
      }
    },
    preview: { port: 5173, strictPort: true },
    build: {
      target: "es2022",
      sourcemap: true,
      // Enforces the initial-bundle budget from SDD 21.5 / PERF-11.
      chunkSizeWarningLimit: 200,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            redux: ["@reduxjs/toolkit", "react-redux"]
          }
        }
      }
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./test/setup.ts"],
      include: ["test/**/*.test.{ts,tsx}"],
      css: false
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxIb21lXFxcXERvd25sb2Fkc1xcXFxsZWVuLW1hcnRcXFxcYXBwc1xcXFxjdXN0b21lci1wd2FcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXEhvbWVcXFxcRG93bmxvYWRzXFxcXGxlZW4tbWFydFxcXFxhcHBzXFxcXGN1c3RvbWVyLXB3YVxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvSG9tZS9Eb3dubG9hZHMvbGVlbi1tYXJ0L2FwcHMvY3VzdG9tZXItcHdhL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCwgVVJMIH0gZnJvbSAnbm9kZTp1cmwnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+IHtcbiAgY29uc3QgZW52ID0gbG9hZEVudihtb2RlLCBwcm9jZXNzLmN3ZCgpLCAnVklURV8nKTtcblxuICByZXR1cm4ge1xuICAgIHBsdWdpbnM6IFtcbiAgICAgIHJlYWN0KCksXG4gICAgICBWaXRlUFdBKHtcbiAgICAgICAgcmVnaXN0ZXJUeXBlOiAncHJvbXB0JyxcbiAgICAgICAgaW5jbHVkZUFzc2V0czogWydmYXZpY29uLnN2ZyddLFxuICAgICAgICBtYW5pZmVzdDoge1xuICAgICAgICAgIG5hbWU6ICdMZWVuIE1hcnQnLFxuICAgICAgICAgIHNob3J0X25hbWU6ICdMZWVuIE1hcnQnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnSHlwZXJsb2NhbCBtdWx0aS12ZW5kb3IgbWFya2V0cGxhY2UnLFxuICAgICAgICAgIHRoZW1lX2NvbG9yOiAnIzBmNzY2ZScsXG4gICAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyNmZmZmZmYnLFxuICAgICAgICAgIGRpc3BsYXk6ICdzdGFuZGFsb25lJyxcbiAgICAgICAgICBvcmllbnRhdGlvbjogJ3BvcnRyYWl0JyxcbiAgICAgICAgICBzdGFydF91cmw6ICcvJyxcbiAgICAgICAgICBpY29uczogW1xuICAgICAgICAgICAgeyBzcmM6ICdwd2EtMTkyeDE5Mi5wbmcnLCBzaXplczogJzE5MngxOTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9LFxuICAgICAgICAgICAgeyBzcmM6ICdwd2EtNTEyeDUxMi5wbmcnLCBzaXplczogJzUxMng1MTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6ICdwd2EtNTEyeDUxMi5wbmcnLFxuICAgICAgICAgICAgICBzaXplczogJzUxMng1MTInLFxuICAgICAgICAgICAgICB0eXBlOiAnaW1hZ2UvcG5nJyxcbiAgICAgICAgICAgICAgcHVycG9zZTogJ21hc2thYmxlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgd29ya2JveDoge1xuICAgICAgICAgIGdsb2JQYXR0ZXJuczogWycqKi8qLntqcyxjc3MsaHRtbCxzdmcscG5nLHdvZmYyfSddLFxuICAgICAgICAgIC8vIEFwcCBzaGVsbCBvbmx5LiBBdXRoZW50aWNhdGVkIEFQSSByZXNwb25zZXMgYXJlIG5ldmVyIGNhY2hlZDpcbiAgICAgICAgICAvLyBhIHNlcnZpY2Utd29ya2VyIGNhY2hlIHN1cnZpdmVzIGxvZ291dCBhbmQgbGVha3MgZGF0YSBvbiBhIHNoYXJlZFxuICAgICAgICAgIC8vIGRldmljZSAoU0REIDIzLjEsIFNFQy0xNCkuXG4gICAgICAgICAgbmF2aWdhdGVGYWxsYmFja0RlbnlsaXN0OiBbL15cXC9hcGlcXC8vXSxcbiAgICAgICAgICBydW50aW1lQ2FjaGluZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2NkblxcLi4qXFwuKD86cG5nfGpwZ3xqcGVnfHN2Z3x3ZWJwfGF2aWYpJC8sXG4gICAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcbiAgICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNhY2hlTmFtZTogJ3Byb2R1Y3QtbWVkaWEnLFxuICAgICAgICAgICAgICAgIGV4cGlyYXRpb246IHsgbWF4RW50cmllczogMjAwLCBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzMCB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICBkZXZPcHRpb25zOiB7IGVuYWJsZWQ6IGZhbHNlIH0sXG4gICAgICB9KSxcbiAgICBdLFxuICAgIHJlc29sdmU6IHtcbiAgICAgIGFsaWFzOiB7XG4gICAgICAgICdAJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL3NyYycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgfSxcbiAgICB9LFxuICAgIHNlcnZlcjoge1xuICAgICAgcG9ydDogNTE3MyxcbiAgICAgIHN0cmljdFBvcnQ6IHRydWUsXG4gICAgICBwcm94eToge1xuICAgICAgICAnL2FwaSc6IHtcbiAgICAgICAgICB0YXJnZXQ6IGVudi5WSVRFX0FQSV9QUk9YWV9UQVJHRVQgPz8gJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwMCcsXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIHByZXZpZXc6IHsgcG9ydDogNTE3Mywgc3RyaWN0UG9ydDogdHJ1ZSB9LFxuICAgIGJ1aWxkOiB7XG4gICAgICB0YXJnZXQ6ICdlczIwMjInLFxuICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgLy8gRW5mb3JjZXMgdGhlIGluaXRpYWwtYnVuZGxlIGJ1ZGdldCBmcm9tIFNERCAyMS41IC8gUEVSRi0xMS5cbiAgICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMjAwLFxuICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICAgIHJlYWN0OiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXG4gICAgICAgICAgICByZWR1eDogWydAcmVkdXhqcy90b29sa2l0JywgJ3JlYWN0LXJlZHV4J10sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICB0ZXN0OiB7XG4gICAgICBlbnZpcm9ubWVudDogJ2pzZG9tJyxcbiAgICAgIGdsb2JhbHM6IHRydWUsXG4gICAgICBzZXR1cEZpbGVzOiBbJy4vdGVzdC9zZXR1cC50cyddLFxuICAgICAgaW5jbHVkZTogWyd0ZXN0LyoqLyoudGVzdC57dHMsdHN4fSddLFxuICAgICAgY3NzOiBmYWxzZSxcbiAgICB9LFxuICB9O1xufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlWLFNBQVMsZUFBZSxXQUFXO0FBQzVYLFNBQVMsY0FBYyxlQUFlO0FBQ3RDLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWU7QUFIbU0sSUFBTSwyQ0FBMkM7QUFLNVEsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE1BQU07QUFDeEMsUUFBTSxNQUFNLFFBQVEsTUFBTSxRQUFRLElBQUksR0FBRyxPQUFPO0FBRWhELFNBQU87QUFBQSxJQUNMLFNBQVM7QUFBQSxNQUNQLE1BQU07QUFBQSxNQUNOLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQSxRQUNkLGVBQWUsQ0FBQyxhQUFhO0FBQUEsUUFDN0IsVUFBVTtBQUFBLFVBQ1IsTUFBTTtBQUFBLFVBQ04sWUFBWTtBQUFBLFVBQ1osYUFBYTtBQUFBLFVBQ2IsYUFBYTtBQUFBLFVBQ2Isa0JBQWtCO0FBQUEsVUFDbEIsU0FBUztBQUFBLFVBQ1QsYUFBYTtBQUFBLFVBQ2IsV0FBVztBQUFBLFVBQ1gsT0FBTztBQUFBLFlBQ0wsRUFBRSxLQUFLLG1CQUFtQixPQUFPLFdBQVcsTUFBTSxZQUFZO0FBQUEsWUFDOUQsRUFBRSxLQUFLLG1CQUFtQixPQUFPLFdBQVcsTUFBTSxZQUFZO0FBQUEsWUFDOUQ7QUFBQSxjQUNFLEtBQUs7QUFBQSxjQUNMLE9BQU87QUFBQSxjQUNQLE1BQU07QUFBQSxjQUNOLFNBQVM7QUFBQSxZQUNYO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFBQSxRQUNBLFNBQVM7QUFBQSxVQUNQLGNBQWMsQ0FBQyxrQ0FBa0M7QUFBQTtBQUFBO0FBQUE7QUFBQSxVQUlqRCwwQkFBMEIsQ0FBQyxVQUFVO0FBQUEsVUFDckMsZ0JBQWdCO0FBQUEsWUFDZDtBQUFBLGNBQ0UsWUFBWTtBQUFBLGNBQ1osU0FBUztBQUFBLGNBQ1QsU0FBUztBQUFBLGdCQUNQLFdBQVc7QUFBQSxnQkFDWCxZQUFZLEVBQUUsWUFBWSxLQUFLLGVBQWUsS0FBSyxLQUFLLEtBQUssR0FBRztBQUFBLGNBQ2xFO0FBQUEsWUFDRjtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsUUFDQSxZQUFZLEVBQUUsU0FBUyxNQUFNO0FBQUEsTUFDL0IsQ0FBQztBQUFBLElBQ0g7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQLE9BQU87QUFBQSxRQUNMLEtBQUssY0FBYyxJQUFJLElBQUksU0FBUyx3Q0FBZSxDQUFDO0FBQUEsTUFDdEQ7QUFBQSxJQUNGO0FBQUEsSUFDQSxRQUFRO0FBQUEsTUFDTixNQUFNO0FBQUEsTUFDTixZQUFZO0FBQUEsTUFDWixPQUFPO0FBQUEsUUFDTCxRQUFRO0FBQUEsVUFDTixRQUFRLElBQUkseUJBQXlCO0FBQUEsVUFDckMsY0FBYztBQUFBLFFBQ2hCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxJQUNBLFNBQVMsRUFBRSxNQUFNLE1BQU0sWUFBWSxLQUFLO0FBQUEsSUFDeEMsT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLE1BQ1IsV0FBVztBQUFBO0FBQUEsTUFFWCx1QkFBdUI7QUFBQSxNQUN2QixlQUFlO0FBQUEsUUFDYixRQUFRO0FBQUEsVUFDTixjQUFjO0FBQUEsWUFDWixPQUFPLENBQUMsU0FBUyxhQUFhLGtCQUFrQjtBQUFBLFlBQ2hELE9BQU8sQ0FBQyxvQkFBb0IsYUFBYTtBQUFBLFVBQzNDO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxNQUFNO0FBQUEsTUFDSixhQUFhO0FBQUEsTUFDYixTQUFTO0FBQUEsTUFDVCxZQUFZLENBQUMsaUJBQWlCO0FBQUEsTUFDOUIsU0FBUyxDQUFDLHlCQUF5QjtBQUFBLE1BQ25DLEtBQUs7QUFBQSxJQUNQO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==

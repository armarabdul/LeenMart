import sharedPreset from '@leen-mart/ui/tailwind-preset';

/**
 * `presets` layers the shared design-system tokens (Phase B) underneath
 * this app's own config — `primary`/`success`/`background`/etc. come from
 * `@leen-mart/ui`. The preset's own comment names the rule this follows:
 * customer-pwa stays teal, vendor-portal stays amber, "never one global
 * identity" — the admin console gets its own distinct `brand` scale
 * (indigo) for the same reason.
 */
/** @type {import('tailwindcss').Config} */
export default {
  presets: [sharedPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

import sharedPreset from '@leen-mart/ui/tailwind-preset';

/**
 * `presets` layers the shared design-system tokens (Phase B) underneath
 * this app's own config — `primary`/`success`/`background`/etc. come from
 * `@leen-mart/ui`, while `colors.brand` below stays exactly as it was.
 * Nothing existing had to move: every `bg-brand-700`-style class already in
 * this app keeps working unchanged.
 */
/** @type {import('tailwindcss').Config} */
export default {
  presets: [sharedPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          900: '#134e4a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

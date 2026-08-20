/**
 * Shared Tailwind preset (Phase B design system).
 *
 * Formalizes the tokens the Phase A audit proposed — it does not replace
 * either app's own `brand` scale. Both `customer-pwa` and `vendor-portal`
 * keep their existing `colors.brand.*` extension untouched (dozens of
 * existing `bg-brand-700`-style classes depend on it) and add this preset
 * *alongside* it via `presets: [require('@leen-mart/ui/tailwind-preset')]`.
 *
 * `primary` is the one token that must differ per app (SDD: Customer PWA
 * stays teal, Vendor Portal stays amber — never one global identity). It is
 * defined as a CSS custom property in RGB-channel form
 * (`rgb(var(--ui-primary) / <alpha-value>)`) so Tailwind's opacity
 * modifiers (`bg-primary/10`) keep working, and each app sets the actual
 * channels once in its own `styles.css`:
 *
 *   customer-pwa  --ui-primary: 15 118 110;   (teal-700,  #0f766e)
 *   vendor-portal --ui-primary: 180 83 9;     (amber-700, #b45309)
 *
 * Every other color below is shared and static — these are genuinely
 * semantic (success/warning/danger/info) or neutral (background/surface/
 * border/text) and have no reason to differ between the two apps.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--ui-primary) / <alpha-value>)',
          hover: 'rgb(var(--ui-primary-hover) / <alpha-value>)',
          soft: 'rgb(var(--ui-primary) / 0.1)',
        },
        'on-primary': '#ffffff',
        success: '#15803d',
        warning: '#a16207',
        danger: '#b91c1c',
        info: '#0369a1',
        background: '#f6f8f7',
        surface: '#ffffff',
        'surface-alt': '#edf2f0',
        border: '#dbe4e0',
        'border-strong': '#c2d0cb',
        text: {
          DEFAULT: '#142420',
          muted: '#56655f',
          faint: '#8a978f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Archivo', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      spacing: {
        18: '4.5rem',
      },
      borderRadius: {
        card: '0.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 36, 32, 0.05), 0 8px 24px -12px rgba(20, 36, 32, 0.12)',
      },
    },
  },
  plugins: [],
};

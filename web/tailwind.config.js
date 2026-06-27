/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'var(--color-background)',
          dark: 'var(--color-background-dark)',
          crimson: 'var(--color-background-crimson)',
          light: 'var(--color-background-light)',
        },
        foreground: 'var(--color-foreground)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          hover: 'var(--color-surface-hover)',
          dark: 'var(--color-surface-dark)',
        },
        text: {
          DEFAULT: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
          dark: 'var(--color-text-dark)',
          'muted-dark': 'var(--color-text-muted-dark)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          dark: 'var(--color-border-dark)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          muted: 'var(--color-accent-muted)',
          gold: {
            DEFAULT: 'var(--color-accent-gold)',
            hover: 'var(--color-accent-gold-hover)',
            muted: 'var(--color-accent-gold-muted)',
          },
          foreground: 'var(--color-accent-foreground)',
        },
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        serif: 'var(--font-serif)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        neon: 'var(--shadow-neon)',
      },
      transitionDuration: {
        fast: 'var(--transition-fast)',
        normal: 'var(--transition-normal)',
        slow: 'var(--transition-slow)',
      }
    },
  },
  plugins: [],
}

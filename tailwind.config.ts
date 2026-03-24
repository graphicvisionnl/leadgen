import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#FF794F',
        dark: '#0F0F0F',
        surface: '#1A1A1A',
        'surface-2': '#242424',
        border: 'rgba(255,255,255,0.08)',
      },
      fontFamily: {
        sans: ['var(--font-plus-jakarta)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config

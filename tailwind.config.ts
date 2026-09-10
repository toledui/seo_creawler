import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        panel: '#121821',
        panel2: '#18202b',
        line: '#243040',
        muted: '#8fa0b5',
        fg: '#e6edf5',
        accent: '#4f9dff',
        ok: '#3ecf8e',
        warn: '#f5a623',
        bad: '#ff5c5c',
      },
    },
  },
  plugins: [],
} satisfies Config;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        ink: '#111318',
        muted: '#6b7280',
        line: '#e5e7eb',
        paper: '#f7f7f5',
        danger: '#b42318',
      },
    },
  },
  plugins: [],
};

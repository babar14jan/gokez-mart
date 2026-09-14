/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        mart: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        // Facebook-style dark mode palette
        slate: {
          900: '#18191a',
          800: '#242526',
          700: '#3a3b3c',
          600: '#4e4f50',
          500: '#b0b3b8',
          400: '#b0b3b8',
          300: '#e4e6eb',
          200: '#e4e6eb',
          100: '#f0f2f5',
        },
      },
    },
  },
  plugins: [],
};

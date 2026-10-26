/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Brand CTA green — deeper/more saturated than the old emerald-500 so white
        // label text clears WCAG AA contrast and the button reads premium.
        gokez: {
          50: '#effbf4',
          100: '#dbf6e6',
          200: '#b8ebce',
          300: '#86dbb0',
          400: '#4ac78d',
          500: '#16aa68',
          600: '#0a9250',
          700: '#087a43',
          800: '#09623a',
          900: '#085131',
          950: '#063d26',
        },
        canvas: '#faf7ef',
        ink: '#14201a',
        cream: {
          50: '#fdfaf3',
          100: '#f8f3e7',
          200: '#f0e7d3',
          300: '#e6d7b8',
        },
        saffron: {
          50: '#fff8e8',
          100: '#ffefc2',
          200: '#ffdf85',
          300: '#ffca47',
          400: '#f7b21c',
          500: '#e8970a',
          600: '#c67705',
          700: '#9e5808',
          800: '#82470f',
          900: '#6f3b13',
        },
        borderRadius: {
          card: '1rem',
          panel: '1.25rem',
        },
        boxShadow: {
          card: '0 1px 2px rgba(20, 32, 26, 0.04), 0 8px 24px rgba(20, 32, 26, 0.06)',
          lift: '0 4px 10px rgba(20, 32, 26, 0.06), 0 16px 36px rgba(20, 32, 26, 0.10)',
        },
        fontSize: {
          micro: ['12px', { lineHeight: '16px' }],
          label: ['13px', { lineHeight: '18px' }],
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

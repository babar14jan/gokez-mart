/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#10b981',
        'primary-dark': '#065f46',
        'primary-light': '#d1fae5',
        yellow: '#FED102',
        amber: '#E8960A',
        'bg-light': '#f0fdf4',
        'bg-dark': '#18191a',
        'card-dark': '#242526',
      },
      fontFamily: {
        sans: ['Inter-Regular'],
        medium: ['Inter-Medium'],
        semibold: ['Inter-SemiBold'],
        bold: ['Inter-Bold'],
      },
    },
  },
  plugins: [],
};

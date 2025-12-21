/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        midnight: {
          50: '#e4e8f5',
          100: '#c9d1ea',
          200: '#92a3d5',
          300: '#5c76bf',
          400: '#354fa3',
          500: '#1f2f6a',
          600: '#182658',
          700: '#131e47',
          800: '#0d1533',
          900: '#090f26',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  // Button variants are composed dynamically (`btn-${variant}`), so keep them.
  safelist: ['btn-primary', 'btn-soft', 'btn-ghost', 'btn-outline', 'btn-danger', 'btn-success'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f1f0ff',
          100: '#e5e3ff',
          200: '#cecaff',
          300: '#aca4ff',
          400: '#8a7bff',
          500: '#6c5dd3',
          600: '#5b47c7',
          700: '#4c38a8',
          800: '#3f3089',
          900: '#352b6e',
        },
        ink: {
          DEFAULT: '#1b1d3a',
          soft: '#5c5f7e',
          muted: '#9295b3',
        },
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        glass: '0 8px 32px -8px rgba(76, 56, 168, 0.18), inset 0 1px 0 0 rgba(255,255,255,0.6)',
        'glass-dark': '0 8px 32px -8px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255,255,255,0.06)',
        soft: '0 4px 20px -4px rgba(76, 56, 168, 0.15)',
        glow: '0 10px 30px -8px rgba(108, 93, 211, 0.55)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: 0, transform: 'scale(0.96)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(30px, -40px) scale(1.05)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.97)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 18s ease-in-out infinite',
        'float-slow': 'float 26s ease-in-out infinite reverse',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

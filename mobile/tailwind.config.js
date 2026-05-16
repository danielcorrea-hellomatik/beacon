/** @type {import('tailwindcss').Config} */
export default {
  content: [ './index.html', './src/**/*.{svelte,ts,js,html}' ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Accent: naranja cobrizo tipo Claude
        accent: {
          DEFAULT: '#D97757',
          50:  '#FBEEE8',
          100: '#F5D5C5',
          200: '#EBAC8B',
          300: '#E18B66',
          400: '#D97757',
          500: '#C0623F',
          600: '#9C4F33',
          700: '#783C27',
          800: '#54281B',
          900: '#30150F'
        },
        // Background neutrales (dark only)
        bg: {
          base:  '#0E0E10',
          panel: '#161618',
          card:  '#1E1E22',
          line:  '#2A2A2F'
        },
        text: {
          primary:   '#F2F2F4',
          secondary: '#A8A8AE',
          muted:     '#6E6E76'
        },
        status: {
          working:     '#D97757',  // naranja
          idle:        '#3F8F5F',  // verde
          needs_input: '#E5B23F',  // amarillo
          ended:       '#6E6E76'   // gris
        }
      },
      fontFamily: {
        sans: [ 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif' ],
        mono: [ 'JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace' ]
      }
    }
  }
};

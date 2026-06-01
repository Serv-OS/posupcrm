/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:        '#070604',
        'ink-soft': 'rgba(20,18,14,0.70)',
        'ink-line': 'rgba(244,237,223,0.06)',
        paper:      '#F4EDDF',
        'paper-soft':'#EBE3D0',
        ember:      '#E8743C',
        'ember-deep':'#C75A29',
        muted:      '#948A7A',
        dim:        '#6B6359',
        panel:      'rgba(20,18,14,0.60)',
        card:       'rgba(244,237,223,0.035)',
        bdr:        'rgba(244,237,223,0.08)',
      },
      fontFamily: {
        sans:    ['Geist', '-apple-system', 'BlinkMacSystemFont', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
        mono:    ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};

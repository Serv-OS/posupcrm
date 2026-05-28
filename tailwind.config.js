/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:        '#0E0D0A',
        'ink-soft': '#17150F',
        'ink-line': 'rgba(244,237,223,0.10)',
        paper:      '#F4EDDF',
        'paper-soft':'#EBE3D0',
        ember:      '#E8743C',
        'ember-deep':'#C75A29',
        muted:      '#948A7A',
        dim:        '#6B6359',
        panel:      '#17150F',
        card:       '#1E1C16',
        bdr:        'rgba(244,237,223,0.10)',
      },
      fontFamily: {
        sans:    ['Geist', '-apple-system', 'BlinkMacSystemFont', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
        mono:    ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

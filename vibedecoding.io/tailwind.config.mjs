/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Stream colors - soft blue/purple gradient tones from the diagram
        stream: {
          50: '#F0F4F8',   // Very light blue-gray (backgrounds)
          100: '#D9E2EC', // Light blue-gray
          200: '#BCCCDC', // Muted blue
          300: '#9FB3C8', // Medium blue-gray
          400: '#7B8FA8', // Blue-gray
          500: '#4A7CB5', // Primary stream blue
          600: '#3B5998', // Deeper blue
          700: '#6B5B95', // Purple accent
          800: '#5D4E8C', // Deep purple
          900: '#2C3E50', // Dark blue-gray (text)
        },
        // Keep accent as alias for backward compatibility, now using stream colors
        accent: {
          50: '#F0F4F8',
          100: '#D9E2EC',
          200: '#BCCCDC',
          300: '#9FB3C8',
          400: '#7B8FA8',
          500: '#4A7CB5',
          600: '#3B5998',
          700: '#6B5B95',
          800: '#5D4E8C',
          900: '#2C3E50',
          950: '#1a2332',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      backgroundImage: {
        'stream-gradient': 'linear-gradient(135deg, #7BA3D0 0%, #4A7CB5 50%, #6B5B95 100%)',
        'stream-gradient-subtle': 'linear-gradient(135deg, #F0F4F8 0%, #D9E2EC 100%)',
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            maxWidth: '75ch',
            color: theme('colors.stream.900'),
            a: {
              color: theme('colors.stream.600'),
              textDecoration: 'none',
              '&:hover': {
                textDecoration: 'underline',
              },
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            code: {
              backgroundColor: theme('colors.stream.100'),
              padding: '0.25rem 0.375rem',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

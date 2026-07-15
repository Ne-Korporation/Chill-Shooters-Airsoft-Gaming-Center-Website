/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware colors (resolved from src/styles/theme.css variables)
        primary: "rgb(var(--primary, 47,79,47))",
        secondary: "rgb(var(--secondary, 85,107,47))",
        accent: "rgb(var(--accent, 197,163,90))",

        background: "rgb(var(--bg))",
        card: "rgb(var(--card))",
        border: "rgb(var(--border))",

        text: "rgb(var(--text))",
        muted: "rgb(var(--muted))",

        success: "rgb(63,163,77)",
        danger: "rgb(214,69,69)",
      },
      borderRadius: {
        xl: '16px',
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0,0,0,0.35)',
        glass: '0 0 0 1px rgba(255,255,255,0.06), 0 10px 30px rgba(0,0,0,0.35)',
      },
      backgroundImage: {
        'camouflage': "radial-gradient(circle at 20% 30%, rgba(47,79,47,0.25), transparent 45%), radial-gradient(circle at 80% 10%, rgba(85,107,47,0.22), transparent 40%), radial-gradient(circle at 60% 80%, rgba(197,163,90,0.12), transparent 45%), linear-gradient(180deg, rgba(18,18,18,1), rgba(18,18,18,0.8))",
      },
      keyframes: {
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        floaty: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        gradientShift: 'gradientShift 10s ease-in-out infinite',
        floaty: 'floaty 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}


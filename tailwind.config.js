/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        none: "0",
        sm: "var(--shape-control-radius, 0.375rem)",
        DEFAULT: "var(--shape-control-radius, 0.5rem)",
        md: "var(--shape-control-radius, 0.5rem)",
        lg: "var(--shape-surface-radius, 0.75rem)",
        xl: "var(--shape-surface-radius, 0.75rem)",
        "2xl": "var(--shape-surface-radius, 0.75rem)",
        "3xl": "var(--shape-surface-radius, 0.75rem)",
        full: "9999px",
      },
    },
  },
  plugins: [],
}

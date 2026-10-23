/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0B0F17',
          surface: '#111827',
          card: '#1F2937',
          border: '#374151',
          hover: '#2D3748',
        },
        brand: {
          primary: '#6366F1',
          primaryHover: '#4F46E5',
          cyan: '#06B6D4',
          emerald: '#10B981',
          rose: '#F43F5E',
          amber: '#F59E0B',
        }
      },
    },
  },
  plugins: [],
}

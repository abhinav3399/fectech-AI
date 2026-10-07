/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            // Mirror the design tokens in src/index.css so Tailwind utilities
            // (bg-grad-brand, text-ink-muted, rounded-lg, shadow-glow…) stay on-brand.
            colors: {
                brand: { DEFAULT: '#8b5cf6', 1: '#8b5cf6', 2: '#6366f1', 3: '#3b82f6' },
                ink: { DEFAULT: '#f1f5f9', muted: '#94a3b8', dim: '#64748b' },
                surface: { DEFAULT: '#0a0e1a', 2: '#0f172a' },
                cyanx: '#22d3ee',
                pinkx: '#f472b6',
            },
            borderRadius: { sm: '10px', md: '14px', lg: '20px', xl: '28px' },
            boxShadow: {
                soft: '0 12px 34px rgba(0,0,0,0.38)',
                lift: '0 28px 64px rgba(0,0,0,0.55)',
                glow: '0 10px 36px rgba(124,58,237,0.38)',
            },
            backgroundImage: {
                'grad-brand': 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #3b82f6 100%)',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
            },
        },
    },
    plugins: [],
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev single-origin: the browser only ever talks to the Vite URL.
    // Calls to /api are proxied to the FastAPI backend, so no CORS and no
    // hardcoded backend host in the frontend.
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})

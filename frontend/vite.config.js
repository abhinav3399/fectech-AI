import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the heavy 3D stack into its own chunk so it downloads/caches
        // separately from the core app (the avatar 3D view is opt-in).
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
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
      // Generated 3D models are served by the backend at /static/models/*.glb.
      // Proxy /static too so they load in dev (in prod the backend serves both).
      '/static': {
        target: 'http://localhost:8010',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})

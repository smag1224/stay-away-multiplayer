import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
      },
    },
    // Ensure Vite doesn't compress SSE responses
    headers: {
      'Cache-Control': 'no-transform',
    },
  },
  preview: {
    host: true,
  },
})

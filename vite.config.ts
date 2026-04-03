import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'server/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['e2e/**', 'playwright-report/**', 'test-results/**'],
  },
  server: {
    host: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
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
  build: {
    // Raise warning threshold — our chunks are intentionally larger (game assets)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'vendor-framer';
          }
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'vendor-i18n';
          }
        },
      },
    },
  },
})

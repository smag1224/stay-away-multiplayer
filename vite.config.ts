import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Don't inject manifest — we have our own public/manifest.json
      manifest: false,
      workbox: {
        // Precache JS/CSS/fonts/icons; skip large backgrounds (they're runtime-cached)
        globPatterns: ['**/*.{js,css,html,woff,woff2,ttf,png,svg}'],
        globIgnores: ['**/backgrounds/**', '**/music/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MB safety limit
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Large backgrounds: cache-first after first load
            urlPattern: /\/backgrounds\/.+/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'backgrounds',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Card images and sounds: cache-first, long TTL
            urlPattern: /\/(cards|sounds|icons)\/.+/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-assets',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // API: always network, never cache
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
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

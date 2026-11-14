import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // MapLibre's worker is an ES module (imported with `?worker&url` in MapView).
  worker: { format: 'es' },
  // The lazily loaded map chunk (maplibre-gl + deck.gl) is ~1.8 MB minified by design.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

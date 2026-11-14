import { defineConfig } from '@playwright/test'

/**
 * Slider smoothness run (map-performance skill, "Measuring"). Local only: CI runners are too
 * noisy for timing. Measures the production build (`vite preview`, which proxies /api like the
 * dev server) against the fixture backend. Uses the installed Google Chrome so no browser
 * download is needed.
 *
 * If something already listens on :8000 it is reused, so make sure it runs with PLAN_FIXTURES=1.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.perf\.ts$/,
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu'] },
  },
  webServer: [
    {
      command: 'uv run --directory ../backend python manage.py runserver 8000 --noreload',
      url: 'http://localhost:8000/api/healthz',
      env: { PLAN_FIXTURES: '1' },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})

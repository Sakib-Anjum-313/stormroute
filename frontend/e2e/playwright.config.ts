import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

/**
 * End-to-end specs (PLAN section 9) against the fixture backend (`PLAN_FIXTURES=1`, no network to
 * TomTom or Open-Meteo) and the production build served by `vite preview`.
 *
 * The API runs on its own port and is never reused, so every run starts with an empty throttle
 * cache: the backend allows 10 plans/min/IP and the whole suite submits 8 plans. Keep it under 10,
 * or space the plans out, when adding specs. That is also why there are no retries.
 *
 * Local runs use the installed Google Chrome (no browser download); CI uses Playwright's bundled
 * Chromium (`pnpm exec playwright install --with-deps chromium`).
 */
const CI = Boolean(process.env.CI)
const API_PORT = 8010
const WEB_PORT = 4174
// webServer commands run in the config's directory by default; pin them to the repo layout.
const FRONTEND_DIR = fileURLToPath(new URL('..', import.meta.url))
const BACKEND_DIR = fileURLToPath(new URL('../../backend', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  testIgnore: /perf\//,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...(CI ? {} : { channel: 'chrome' }),
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: `uv run python manage.py runserver ${API_PORT} --noreload`,
      cwd: BACKEND_DIR,
      url: `http://localhost:${API_PORT}/api/healthz`,
      env: { PLAN_FIXTURES: '1', DJANGO_DEBUG: '1' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm build && pnpm preview --port ${WEB_PORT} --strictPort`,
      cwd: FRONTEND_DIR,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})

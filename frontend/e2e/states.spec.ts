/**
 * Fixture scenarios (PLAN section 10): each shows its banner or error card, and error cards retry.
 * The backend picks the scenario from `X-Fixture`, which the app forwards from `?fixture=`.
 */
import type { Page } from '@playwright/test'

import { CHROME_422_LINE, expect, isPlanPost, test } from './support.ts'

async function planDemo(page: Page, fixture: string) {
  await page.goto(`/?fixture=${fixture}`)
  const response = page.waitForResponse(isPlanPost)
  await page.getByRole('button', { name: 'Try demo trip' }).click()
  return response
}

test('two_routes: two cards and the fewer-than-3 banner', async ({ page }) => {
  await planDemo(page, 'two_routes')
  await expect(page.getByTestId('plan-summary')).toBeVisible()
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(2)
  await expect(page.getByTestId('warning-FEWER_THAN_3_ROUTES')).toContainText(
    'Fewer than three routes',
  )
})

test('no_travel_all: the no-safe-route banner, routes still ranked', async ({ page }) => {
  await planDemo(page, 'no_travel_all')
  await expect(page.getByTestId('plan-summary')).toBeVisible()
  const banner = page.getByTestId('plan-banners').getByRole('alert')
  await expect(banner).toContainText('No safe route for this departure and load')
  await expect(banner).toContainText('Routes are still ranked by No Travel miles first.')
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /, recommended$/ })).toHaveCount(1)
})

test('upstream_429: the error card counts down, then Retry plans again', async ({ page }) => {
  // The fixture's retry_after_s is 30; a fake clock skips the wait instead of sleeping.
  await page.clock.install()
  await planDemo(page, 'upstream_429')
  const card = page.getByTestId('error-UPSTREAM_RATE_LIMITED')
  await expect(card).toContainText('Service busy')
  const retry = card.getByRole('button')
  await expect(retry).toHaveText(/^Retry in \d+ s$/)
  await expect(retry).toBeDisabled()

  await page.clock.fastForward(31_000)
  await expect(retry).toHaveText('Retry')
  const second = page.waitForResponse(isPlanPost)
  await retry.click()
  expect((await second).status()).toBe(200) // in-stream error, so the HTTP status is 200
  await expect(page.getByTestId('error-UPSTREAM_RATE_LIMITED')).toBeVisible()
})

test('no_route: the 422 error card, and Retry sends the plan again', async ({
  page,
  consoleGuard,
}) => {
  consoleGuard.allow(CHROME_422_LINE)
  const first = await planDemo(page, 'no_route')
  expect(first.status()).toBe(422)
  const card = page.getByTestId('error-NO_ROUTE')
  await expect(card).toContainText('No truck-legal route found')
  const second = page.waitForResponse(isPlanPost)
  await card.getByRole('button', { name: 'Retry' }).click()
  expect((await second).status()).toBe(422)
  await expect(page.getByTestId('error-NO_ROUTE')).toBeVisible()
  await expect(page.getByTestId('plan-summary')).toHaveCount(0)
})

test('form-level VALIDATION (routing BAD_INPUT) gets a card without Retry', async ({
  page,
  consoleGuard,
}, testInfo) => {
  // No fixture produces this, so the 400 body is stubbed (the shape the backend sends).
  consoleGuard.allow(/Failed to load resource: the server responded with a status of 400/)
  await page.route('**/api/plan', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'VALIDATION',
          message: 'The routing service rejected these trip parameters.',
          details: {},
          retry_after_s: null,
        },
      }),
    }),
  )
  await planDemo(page, 'default')
  const card = page.getByTestId('error-VALIDATION')
  await expect(card).toContainText('Check the trip details')
  await expect(card).toContainText('The routing service rejected these trip parameters.')
  await expect(card.getByRole('button')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('validation-card.png') })
})

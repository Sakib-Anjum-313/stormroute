/** Phone layout: the bottom sheet's tabs, the slider within reach and no horizontal scroll. */
import { expect, test, waitForMapIdle } from './support.ts'

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })

test('phone: bottom-sheet tabs switch panels and the slider stays reachable', async ({
  page,
}, testInfo) => {
  await page.goto('/?fixture=default')
  const tabs = page.getByRole('tablist', { name: 'Panels' })
  await expect(tabs.getByRole('tab')).toHaveText(['Trip', 'Routes', 'Why'])
  const tripTab = page.getByRole('tab', { name: 'Trip' })
  await expect(tripTab).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: 'Try demo trip' }).tap()
  // Planning switches the sheet to Routes on its own.
  const routesTab = page.getByRole('tab', { name: 'Routes' })
  await expect(routesTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('plan-summary')).toBeVisible()
  await expect(page.locator('[data-testid^="route-card-"]')).toHaveCount(3)
  await expect(page.getByRole('form', { name: 'Trip' })).toBeHidden()

  await page.getByRole('tab', { name: 'Why' }).tap()
  await expect(page.getByTestId('why-panel')).toBeVisible()
  await expect(page.getByTestId('plan-summary')).toBeHidden()

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  await page.getByRole('tab', { name: 'Why' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tripTab).toHaveAttribute('aria-selected', 'true')
  await expect(tripTab).toBeFocused()

  await expect(page.getByTestId('heatmap-slider')).toBeInViewport()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)

  await waitForMapIdle(page)
  await page.screenshot({ path: testInfo.outputPath('phone.png') })
})

/**
 * Happy path (PLAN section 9, ★): demo trip, three route cards, the Recommended badge, the
 * interval toggle, a checkpoint popup and a slider scrub that makes no network requests.
 */
import {
  capturePlan,
  expect,
  isAppRequest,
  projectToPage,
  test,
  waitForMapIdle,
} from './support.ts'

test('demo trip: cards, recommendation, popup and a request-free scrub', async ({
  page,
}, testInfo) => {
  await page.goto('/?fixture=default')

  const nextPlan = await capturePlan(page)
  await page.getByRole('button', { name: 'Try demo trip' }).click()
  const plan = await nextPlan()
  await expect(page.getByTestId('plan-summary')).toBeVisible()

  // Three cards in provider order, exactly one recommended (the backend's pick at 25 mi).
  const cards = page.locator('[data-testid^="route-card-"]')
  await expect(cards).toHaveCount(3)
  const recommendedId = plan.recommendation['25'].route_id
  await expect(page.getByRole('button', { name: /, recommended$/ })).toHaveCount(1)
  await expect(page.getByTestId(`route-card-${recommendedId}`)).toContainText('Recommended')

  // Interval toggle: 25 mi is the default; go to 10 and back to 25 with no request.
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const every10 = page.getByRole('button', { name: 'Every 10 mi' })
  const every25 = page.getByRole('button', { name: 'Every 25 mi' })
  await expect(every25).toHaveAttribute('aria-pressed', 'true')
  await every10.click()
  await expect(every10).toHaveAttribute('aria-pressed', 'true')
  await every25.click()
  await expect(every25).toHaveAttribute('aria-pressed', 'true')
  // The map may still be fetching basemap tiles for the initial fit; nothing else may load.
  expect(requests.filter(isAppRequest), 'requests during the interval toggle').toEqual([])

  // Checkpoint popup: click a mid-route checkpoint of the recommended (selected, topmost) route.
  await waitForMapIdle(page)
  const route = plan.routes.find((r) => r.id === recommendedId)
  const checkpoints = route?.intervals['25'].checkpoints ?? []
  const checkpoint = checkpoints[Math.floor(checkpoints.length / 2)]
  if (!checkpoint) throw new Error('recommended route has no checkpoints')
  const [x, y] = await projectToPage(page, checkpoint.lon, checkpoint.lat)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
  const popup = page.getByTestId('map-popup')
  await expect(popup).toBeVisible()
  await expect(popup).toContainText(`mile ${checkpoint.mile.toFixed(1)}`)
  await expect(popup).toContainText('ETA')
  for (const name of ['Wind', 'Gusts', 'Rain', 'Snow']) await expect(popup).toContainText(name)
  await expect(popup).toContainText(/mph/)
  await expect(popup).toContainText(/in\/hr/)
  for (const trigger of checkpoint.triggers) await expect(popup).toContainText(trigger.detail)
  if (checkpoint.triggers.length === 0) {
    await expect(popup).toContainText('All conditions are below the Moderate thresholds.')
  }
  await page.screenshot({ path: testInfo.outputPath('popup.png') })
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(popup).toBeHidden()

  // Slider scrub: keyboard steps and a pointer drag across 0-48 h, all from memory.
  await page.waitForLoadState('networkidle')
  requests.length = 0
  const slider = page.getByTestId('heatmap-slider')
  const label = page.locator('output[for="heatmap-hour"]')
  const before = await page.evaluate(() => window.spotterScene?.frameKey ?? 0)
  const startLabel = await label.textContent()
  await slider.focus()
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
  await expect(label).not.toHaveText(startLabel ?? '')
  const box = await slider.boundingBox()
  if (!box) throw new Error('slider not visible')
  const sliderY = box.y + box.height / 2
  await page.mouse.move(box.x + 4, sliderY)
  await page.mouse.down()
  for (let i = 1; i <= 40; i++)
    await page.mouse.move(box.x + 4 + ((box.width - 8) * i) / 40, sliderY)
  await page.mouse.up()
  expect(Number(await slider.inputValue())).toBeGreaterThan(44)
  const after = await page.evaluate(() => window.spotterScene?.frameKey ?? 0)
  expect(after - before, 'heatmap frames blended during the scrub').toBeGreaterThan(10)
  expect(requests, 'requests during the scrub').toEqual([])

  await page.screenshot({ path: testInfo.outputPath('happy-path.png') })
  await testInfo.attach('happy-path', {
    path: testInfo.outputPath('happy-path.png'),
    contentType: 'image/png',
  })
})

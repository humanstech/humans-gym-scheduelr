import { test, expect } from '@playwright/test'
import { clearBookings, openFutureDay } from './helpers'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test('mobile booking and cancellation without horizontal overflow', async ({ page, request }) => {
  await clearBookings(request)
  await openFutureDay(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.getByRole('button', { name: 'Prenota', exact: true }).first().tap()
  await expect(page.getByText('Prenotazione confermata!')).toBeVisible()
  await page.getByRole('button', { name: 'Cancella prenotazione' }).tap()
  await expect(page.getByText('Prenotazione cancellata.')).toBeVisible()
})

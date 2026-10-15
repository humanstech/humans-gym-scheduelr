import { test, expect } from '@playwright/test'
import { clearBookings, openFutureDay } from './helpers'

test.beforeEach(async ({ request }) => clearBookings(request))

test('books and cancels a slot with the per-day limit', async ({ page }) => {
  await openFutureDay(page)
  await page.getByRole('button', { name: 'Prenota', exact: true }).first().click()
  await expect(page.getByText('Prenotazione confermata!')).toBeVisible()
  await expect(page.getByText('Hai già uno slot', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancella prenotazione' }).click()
  await expect(page.getByText('Prenotazione cancellata.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prenota', exact: true })).toHaveCount(2)
})

test('deep-link reload works through the production web server', async ({ page }) => {
  await openFutureDay(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: /^Prenota in E2E/ })).toBeVisible()
})

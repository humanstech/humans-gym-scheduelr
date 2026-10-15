import { test, expect } from '@playwright/test'
import { clearBookings, openFutureDay } from './helpers'

test.beforeEach(async ({ request }) => clearBookings(request))

test('booking appears in personal list and can be removed', async ({ page }) => {
  await openFutureDay(page)
  await page.getByRole('button', { name: 'Prenota', exact: true }).first().click()
  await expect(page.getByText('Prenotazione confermata!')).toBeVisible()
  await page.goto('/my-bookings')
  await page.getByRole('button', { name: 'Cancella prenotazione' }).click()
  await expect(page.getByText('Nessuna prenotazione', { exact: true })).toBeVisible()
})

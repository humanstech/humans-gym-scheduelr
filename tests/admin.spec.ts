import { test, expect } from '@playwright/test'
import { API_URL, SERVICE_KEY } from './config'
import { fixtures } from './helpers'

test('regular user cannot open admin', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Prenota una sessione' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
})

test.describe('Administrator', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })
  test('can promote a user after confirmation and grant admin access', async ({ page, request, browser }) => {
    const email = `e2e-user-${fixtures().suffix}@humans.tech`
    try {
      await page.goto('/admin?tab=utenti')
      await page.getByRole('searchbox', { name: 'Cerca per nome o email' }).fill(email)
      await page.getByRole('button', { name: 'Apri dettaglio di E2E user' }).click()
      const detail = page.getByRole('dialog', { name: 'Dettaglio utente' })
      await detail.getByRole('button', { name: 'Rendi admin', exact: true }).click()
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation).toContainText(email)
      await confirmation.getByRole('button', { name: 'Annulla', exact: true }).click()
      await expect(confirmation).toBeHidden()
      await expect(detail.getByText('Admin', { exact: true })).toHaveCount(0)
      await detail.getByRole('button', { name: 'Rendi admin', exact: true }).click()
      await confirmation.getByRole('button', { name: 'Conferma', exact: true }).click()
      await expect(detail.getByText('Admin', { exact: true })).toBeVisible()
      await expect(detail.getByRole('button', { name: 'Rendi admin', exact: true })).toHaveCount(0)

      await page.reload()
      await page.getByRole('searchbox', { name: 'Cerca per nome o email' }).fill(email)
      await expect(page.getByRole('button', { name: 'Apri dettaglio di E2E user' }).getByText('Admin', { exact: true })).toBeVisible()

      const promotedContext = await browser.newContext({ storageState: 'tests/.auth/user.json' })
      try {
        const promotedPage = await promotedContext.newPage()
        await promotedPage.goto('/admin')
        await expect(promotedPage.getByRole('heading', { name: 'Area Admin' })).toBeVisible()
      } finally {
        await promotedContext.close()
      }
    } finally {
      const response = await request.delete(`${API_URL}/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      })
      expect(response.ok(), await response.text()).toBeTruthy()
    }
  })

  test('can open statistics, spaces and access control', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Area Admin' })).toBeVisible()
    await page.getByRole('tab', { name: 'Spazi', exact: true }).click()
    await expect(page.getByText('Palestra', { exact: true }).first()).toBeVisible()
    await page.getByRole('tab', { name: 'Accessi' }).click()
    await expect(page.getByText('@humans.tech', { exact: true })).toBeVisible()
  })
})

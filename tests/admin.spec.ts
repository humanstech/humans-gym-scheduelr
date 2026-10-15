import { test, expect } from '@playwright/test'

test('regular user cannot open admin', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Prenota una sessione' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
})

test.describe('Administrator', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })
  test('can open statistics, spaces and access control', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Area Admin' })).toBeVisible()
    await page.getByRole('tab', { name: 'Spazi', exact: true }).click()
    await expect(page.getByText('Palestra', { exact: true }).first()).toBeVisible()
    await page.getByRole('tab', { name: 'Accessi' }).click()
    await expect(page.getByText('@humans.tech', { exact: true })).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'

test.use({ javaScriptEnabled: false, storageState: { cookies: [], origins: [] } })
for (const [path, title] of [['/terms', 'Termini e condizioni'], ['/privacy', 'Privacy policy'], ['/cookies', 'Cookie policy']]) {
  test(`${path} is public and readable without JavaScript`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Informazioni legali' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
  })
}

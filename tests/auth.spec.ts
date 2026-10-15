import { test, expect } from '@playwright/test'
import { fixtures } from './helpers'

test.describe('Anonymous access', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test('public health endpoint is not the SPA fallback', async ({ request }) => {
    const response = await request.get('/healthz')
    expect(response.status()).toBe(200)
    expect(await response.text()).toBe('ok')
  })
  for (const route of ['/', '/admin', '/my-bookings']) {
    test(`${route} requires login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('heading', { name: 'Gym' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Accedi con Google' })).toBeVisible()
    })
  }
  test('guest magic-link form is available', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /Sei un ospite/ }).click()
    await expect(page.getByPlaceholder('tua@email.com')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invia magic link' })).toBeDisabled()
  })
  test('magic link sent through SMTP signs in via the public callback', async ({ page, request }) => {
    const email = `e2e-user-${fixtures().suffix}@humans.tech`
    await page.goto('/login')
    await page.getByRole('button', { name: /Sei un ospite/ }).click()
    await page.getByPlaceholder('tua@email.com').fill(email)
    await page.getByRole('button', { name: 'Invia magic link' }).click()
    await expect(page.getByRole('heading', { name: 'Controlla la tua email' })).toBeVisible()
    let messageId = ''
    await expect.poll(async () => {
      const response = await request.get('http://localhost:8025/api/v1/messages')
      const data = await response.json()
      const message = data.messages.find((m: { ID: string; To: { Address: string }[] }) => m.To.some(to => to.Address === email))
      messageId = message?.ID ?? ''
      return !!messageId
    }).toBe(true)
    const response = await request.get(`http://localhost:8025/api/v1/message/${messageId}`)
    const mail = await response.json()
    const link = (mail.HTML as string).match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]
    expect(link).toBeTruthy()
    await page.goto(link!.replaceAll('&amp;', '&'))
    await expect(page.getByRole('heading', { name: 'Prenota una sessione' })).toBeVisible()
  })
})

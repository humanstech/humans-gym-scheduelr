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
      await expect(page.getByRole('heading', { name: 'Gym', level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Invia magic link' })).toBeVisible()
    })
  }
  test('Google appears above email and starts OAuth with the public callback', async ({ page }) => {
    await page.route('**/auth/v1/settings', route => route.fulfill({ json: { external: { google: true } } }))
    await page.route('**/auth/v1/authorize?**', route => route.fulfill({ contentType: 'text/html', body: 'OAuth started' }))
    await page.goto('/login')
    const google = page.getByRole('button', { name: 'Accedi con Google' })
    const email = page.getByRole('textbox', { name: 'Email', exact: true })
    await expect(google).toBeVisible()
    await expect(email).toBeVisible()
    const googleBounds = await google.boundingBox()
    const emailBounds = await email.boundingBox()
    expect(googleBounds!.y + googleBounds!.height).toBeLessThan(emailBounds!.y)
    const origin = new URL(page.url()).origin
    const authorizeRequest = page.waitForRequest('**/auth/v1/authorize?**')
    await google.click()
    const url = new URL((await authorizeRequest).url())
    expect(url.searchParams.get('provider')).toBe('google')
    expect(url.searchParams.get('redirect_to')).toBe(`${origin}/auth/callback`)
  })
  test('email remains available when Google is disabled', async ({ page }) => {
    await page.route('**/auth/v1/settings', route => route.fulfill({ json: { external: { google: false } } }))
    await page.goto('/login')
    await expect(page.getByPlaceholder('tua@email.com')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accedi con Google' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Invia magic link' })).toBeDisabled()
  })
  test('returning from email confirmation restores both login methods', async ({ page }) => {
    await page.route('**/auth/v1/settings', route => route.fulfill({ json: { external: { google: true } } }))
    await page.route('**/auth/v1/otp**', route => route.fulfill({ json: {} }))
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Accedi con Google' })).toBeVisible()
    await page.getByPlaceholder('tua@email.com').fill('test@example.com')
    await page.getByRole('button', { name: 'Invia magic link' }).click()
    await expect(page.getByRole('heading', { name: 'Controlla la tua email' })).toBeVisible()
    await page.getByRole('button', { name: 'Torna al login' }).click()
    await expect(page.getByRole('button', { name: 'Accedi con Google' })).toBeVisible()
    await expect(page.getByPlaceholder('tua@email.com')).toHaveValue('')
  })
  test('magic link sent through SMTP signs in via the public callback', async ({ page, request }) => {
    const email = `e2e-user-${fixtures().suffix}@humans.tech`
    await page.goto('/login')
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

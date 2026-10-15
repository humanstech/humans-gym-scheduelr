import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { API_URL, SERVICE_KEY } from './config'

export function fixtures(): { users: string[]; spaceId: string; suffix: string } {
  return JSON.parse(readFileSync('tests/.auth/fixtures.json', 'utf8'))
}
export async function clearBookings(request: APIRequestContext) {
  const { users } = fixtures()
  const response = await request.delete(`${API_URL}/rest/v1/bookings?user_id=in.(${users.join(',')})`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}
export async function openFutureDay(page: Page) {
  await page.goto(`/space/${fixtures().spaceId}`)
  await expect(page.getByRole('heading', { name: /^Prenota in E2E/ })).toBeVisible()
  const dates = page.locator('button[data-date]')
  await expect(dates).toHaveCount(14)
  await dates.nth(2).click()
  await expect(page.getByRole('button', { name: 'Prenota', exact: true }).first()).toBeVisible()
}

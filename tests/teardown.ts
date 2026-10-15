import { test as teardown, expect } from '@playwright/test'
import { API_URL, SERVICE_KEY } from './config'
import { fixtures } from './helpers'

teardown('remove isolated fixtures', async ({ request }) => {
  const data = fixtures()
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  for (const url of [
    `${API_URL}/rest/v1/spaces?id=eq.${data.spaceId}`,
    `${API_URL}/rest/v1/admins?email=like.e2e-admin-${data.suffix}*`,
    ...data.users.map(id => `${API_URL}/auth/v1/admin/users/${id}`),
  ]) {
    const response = await request.delete(url, { headers })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
})

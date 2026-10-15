import { test as setup, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { API_URL, APP_URL, ANON_KEY, SERVICE_KEY, STORAGE_KEY } from './config'

setup('create isolated accounts and space', async ({ request }) => {
  if (!ANON_KEY || !SERVICE_KEY) throw new Error('Generate .env.stack.local and start the local stack first')
  mkdirSync('tests/.auth', { recursive: true })
  const adminHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  const suffix = randomBytes(6).toString('hex')
  const users: string[] = []
  let adminToken = ''
  for (const role of ['user', 'admin']) {
    const email = `e2e-${role}-${suffix}@humans.tech`
    const password = randomBytes(24).toString('base64url')
    const created = await request.post(`${API_URL}/auth/v1/admin/users`, {
      headers: adminHeaders,
      data: { email, password, email_confirm: true, user_metadata: { full_name: `E2E ${role}` } },
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    users.push((await created.json()).id)
    if (role === 'admin') {
      const added = await request.post(`${API_URL}/rest/v1/admins`, { headers: adminHeaders, data: { email } })
      expect(added.ok(), await added.text()).toBeTruthy()
    }
    const login = await request.post(`${API_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON_KEY }, data: { email, password },
    })
    expect(login.ok(), await login.text()).toBeTruthy()
    const session = await login.json()
    if (role === 'admin') adminToken = session.access_token
    writeFileSync(`tests/.auth/${role}.json`, JSON.stringify({
      cookies: [], origins: [{ origin: APP_URL, localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(session) }] }],
    }))
  }
  const space = await request.post(`${API_URL}/rest/v1/spaces`, {
    headers: { ...adminHeaders, Prefer: 'return=representation' },
    data: { name: `E2E ${suffix}`, min_capacity: 1, max_capacity: 2, available_days: [1,2,3,4,5,6,7] },
  })
  expect(space.ok(), await space.text()).toBeTruthy()
  const spaceId = (await space.json())[0].id
  const times = await request.post(`${API_URL}/rest/v1/space_time_slots`, {
    headers: adminHeaders,
    data: Array.from({ length: 7 }, (_, i) => [
      { space_id: spaceId, day_of_week: i + 1, start_time: '10:00', end_time: '11:00' },
      { space_id: spaceId, day_of_week: i + 1, start_time: '18:00', end_time: '19:00' },
    ]).flat(),
  })
  expect(times.ok(), await times.text()).toBeTruthy()
  const generated = await request.post(`${API_URL}/rest/v1/rpc/generate_slots`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${adminToken}` }, data: { days_ahead: 90 },
  })
  expect(generated.ok(), await generated.text()).toBeTruthy()
  writeFileSync('tests/.auth/fixtures.json', JSON.stringify({ users, spaceId, suffix }))
})

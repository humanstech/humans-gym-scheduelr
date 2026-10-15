import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { API_URL, ANON_KEY } from './config'
import { clearBookings, fixtures } from './helpers'

function accessToken(role: string): string {
  const storage = JSON.parse(readFileSync(`tests/.auth/${role}.json`, 'utf8'))
  return JSON.parse(storage.origins[0].localStorage[0].value).access_token
}

test('another user receives slot updates through the WebSocket gateway', async ({ request }) => {
  await clearBookings(request)
  const userToken = accessToken('user')
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${accessToken('admin')}` }
  const future = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10)
  const slots = await request.get(`${API_URL}/rest/v1/slots?space_id=eq.${fixtures().spaceId}&date=gte.${future}&limit=1&order=date`, { headers })
  expect(slots.ok()).toBeTruthy()
  const slotId = (await slots.json())[0].id
  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  await client.realtime.setAuth(userToken)
  let notify: () => void = () => {}
  const changed = new Promise<void>(resolve => { notify = resolve })
  const systemMessages: { status?: string; extension?: string; message?: string }[] = []
  const channel = client.channel('e2e-slot-updates').on('system', {}, payload => systemMessages.push(payload)).on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'slots', filter: `id=eq.${slotId}`,
  }, () => notify())
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 15_000)
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(status)) }
      })
    })
    // The socket may join before the tenant's initial replication connection is ready.
    await expect.poll(() => systemMessages.some(message => message.status === 'ok' && message.extension === 'postgres_changes'), {
      timeout: 15_000,
    }).toBe(true)
    const booking = await request.post(`${API_URL}/rest/v1/rpc/create_booking`, { headers, data: { slot_id: slotId } })
    expect(booking.ok(), await booking.text()).toBeTruthy()
    await Promise.race([changed, new Promise((_, reject) => setTimeout(() => reject(new Error(`No realtime update: ${JSON.stringify(systemMessages)}`)), 8_000))])
  } finally {
    await client.removeChannel(channel)
    client.realtime.disconnect()
  }
})

import { loadEnv } from 'vite'

const env = { ...loadEnv('stack', process.cwd(), ''), ...process.env }
export const API_URL = env.E2E_SUPABASE_URL ?? env.SUPABASE_PUBLIC_URL ?? 'http://localhost:8080'
export const APP_URL = env.E2E_BASE_URL ?? 'http://localhost:8080'
export const ANON_KEY = env.E2E_ANON_KEY ?? env.ANON_KEY ?? ''
export const SERVICE_KEY = env.E2E_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY ?? ''
for (const url of [API_URL, APP_URL]) {
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('E2E writes are restricted to an isolated localhost stack')
  }
}
export const STORAGE_KEY = `sb-${new URL(API_URL).hostname.split('.')[0]}-auth-token`

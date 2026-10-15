import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const LOCAL_HOSTS = ['localhost', '127.0.0.1']

function isLocal(url: string | undefined) {
  try {
    return !!url && LOCAL_HOSTS.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  // The quick login embeds a shared password: only ever for a localhost backend.
  const devLogin = env.VITE_DEV_LOGIN === 'true'
  if (devLogin && !isLocal(env.VITE_SUPABASE_URL)) {
    throw new Error('VITE_DEV_LOGIN=true is allowed only with a localhost/127.0.0.1 VITE_SUPABASE_URL')
  }
  if (devLogin && !env.VITE_DEV_LOGIN_PASSWORD) {
    throw new Error('VITE_DEV_LOGIN=true requires VITE_DEV_LOGIN_PASSWORD (scripts/local.sh dev-env)')
  }
  if (command === 'build') {
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
      throw new Error('Build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
    }
    const url = new URL(env.VITE_SUPABASE_URL)
    if (url.protocol !== 'https:' && !LOCAL_HOSTS.includes(url.hostname)) {
      throw new Error('Supabase must use HTTPS outside localhost')
    }
    const key = env.VITE_SUPABASE_ANON_KEY
    if (key.startsWith('sb_secret_') || (key.split('.').length === 3 &&
      JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role !== 'anon')) {
      throw new Error('Only a public anon/publishable key belongs in the frontend')
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    // Literal values so the dev panel and its password are dropped from other builds.
    define: {
      'import.meta.env.VITE_DEV_LOGIN': JSON.stringify(devLogin ? 'true' : 'false'),
      'import.meta.env.VITE_DEV_LOGIN_PASSWORD': JSON.stringify(devLogin ? env.VITE_DEV_LOGIN_PASSWORD : ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})

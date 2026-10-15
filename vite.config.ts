import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  if (command === 'build') {
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
      throw new Error('Build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
    }
    const url = new URL(env.VITE_SUPABASE_URL)
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})

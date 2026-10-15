import { defineConfig, devices } from '@playwright/test'
import { APP_URL } from './tests/config'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: APP_URL,
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: '**/setup.ts', teardown: 'teardown' },
    { name: 'teardown', testMatch: '**/teardown.ts' },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  // Test the compiled application served by Docker/Caddy, not the Vite dev server.
})

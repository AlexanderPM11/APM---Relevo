import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(workspace, 'test-results', 'frontend-test-report.json') }],
  ],
  outputDir: path.join(workspace, 'output', 'playwright'),
  use: {
    baseURL: 'http://127.0.0.1:5173/console/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:5173/console/',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})

import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testOutput = path.join(workspace, 'output', 'playwright')
mkdirSync(testOutput, { recursive: true })

process.env.RELEVO_E2E_API_URL ??= 'http://127.0.0.1:8765'
process.env.RELEVO_E2E_ADMIN_EMAIL ??= 'playwright-admin@example.com'
process.env.RELEVO_E2E_ADMIN_PASSWORD ??= 'playwright-only-password'
const python = process.env.RELEVO_TEST_PYTHON
  ?? (process.platform === 'win32' ? path.join(workspace, '.venv', 'Scripts', 'python.exe') : 'python')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(workspace, 'test-results', 'frontend-test-report.json') }],
  ],
  outputDir: path.join(workspace, 'output', 'playwright'),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: '**/admin.spec.ts', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: '**/admin.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173/console/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --host 127.0.0.1 --port 8765`,
      url: 'http://127.0.0.1:8765/health',
      cwd: workspace,
      env: {
        APP_ENV: 'development',
        DATABASE_URL: process.env.RELEVO_E2E_DATABASE_URL || 'sqlite+aiosqlite:///:memory:',
        DATABASE_AUTO_CREATE: process.env.RELEVO_E2E_DATABASE_AUTO_CREATE ?? 'true',
        ADMIN_EMAIL: process.env.RELEVO_E2E_ADMIN_EMAIL,
        ADMIN_PASSWORD: process.env.RELEVO_E2E_ADMIN_PASSWORD,
        ADMIN_LOGIN_ATTEMPT_LIMIT: '100',
        JWT_SECRET: 'playwright-only-jwt-secret-long-enough-for-tests',
        API_KEY_PEPPER: 'playwright-only-api-key-pepper-long-enough',
        GROQ_API_KEY: 'playwright-provider-secret',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/mock-provider.mjs',
      url: 'http://127.0.0.1:8766/health',
      cwd: workspace,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:5173/console/',
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: { RELEVO_DEV_API_TARGET: 'http://127.0.0.1:8765' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})

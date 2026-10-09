import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const processEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env
const apiTarget = processEnv?.RELEVO_DEV_API_TARGET || 'http://localhost:8000'

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  server: {
    proxy: {
      '/admin': apiTarget,
      '/v1': apiTarget,
      '/console-config': apiTarget,
      '/health': apiTarget,
      '/ready': apiTarget,
    },
  },
})

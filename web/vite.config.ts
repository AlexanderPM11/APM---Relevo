import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/console/',
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  server: {
    proxy: {
      '/admin': 'http://localhost:8000',
      '/v1': 'http://localhost:8000',
    },
  },
})

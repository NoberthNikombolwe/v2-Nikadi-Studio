import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/sms-proxy': {
        target: 'https://messaging-service.co.tz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sms-proxy/, ''),
      },
      '/wa-proxy': {
        target: 'https://messaging-service.co.tz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wa-proxy/, ''),
      },
    },
  },
})

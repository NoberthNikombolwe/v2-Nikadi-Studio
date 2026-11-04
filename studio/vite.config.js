import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// URL path the app is served from. "/" locally; the GitHub Pages workflow sets
// VITE_BASE_PATH=/<repo-name>/ because Pages serves the site from a sub-folder.
const base = process.env.VITE_BASE_PATH || '/'

// Full site address for the link-preview tags in index.html (%SITE_URL%) — WhatsApp,
// Facebook etc. only accept absolute image URLs. The Pages workflow sets VITE_SITE_URL;
// a local build falls back to the base path (previews only matter once deployed).
const siteUrl = (process.env.VITE_SITE_URL || base).replace(/\/?$/, '/')
const siteUrlPlugin = {
  name: 'nikadi-site-url',
  transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
}

export default defineConfig({
  base,
  plugins: [react(), siteUrlPlugin],
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

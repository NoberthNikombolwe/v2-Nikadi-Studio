import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { runCleanChat, CLEAN_LIMITS } from './supabase/functions/_shared/dataClean.js'
import { runEventPageChat, PAGE_LIMITS } from './supabase/functions/_shared/aiEventPage.js'
import { runSmsDraft, SMS_DRAFT_LIMITS } from './supabase/functions/_shared/aiSmsDraft.js'

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

// `npm run dev` only: answers /ai-clean (the Studio's "Clean data" chat) the way the ai-clean
// Edge Function does in production, with the same instructions and checks (dataClean.js).
// The key is GEMINI_API_KEY in .env.development.local — no VITE_ prefix, so it is read here
// in Node and never reaches the browser bundle. Optional: GEMINI_MODEL.
const aiCleanDevPlugin = {
  name: 'nikadi-ai-clean-dev',
  apply: 'serve',
  configureServer(server) {
    const env = { ...loadEnv(server.config.mode, server.config.envDir || server.config.root, ''), ...process.env }
    const send = (res, status, body) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    server.middlewares.use('/ai-clean', async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
      const apiKey = String(env.GEMINI_API_KEY || '').trim()
      if (!apiKey) return send(res, 500, { error: 'No GEMINI_API_KEY — add it to .env.development.local (without VITE_) and restart npm run dev.' })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > CLEAN_LIMITS.bodyBytes) return send(res, 413, { error: 'That message is too large — send a shorter list or fewer photos.' })
      }
      let payload
      try { payload = JSON.parse(raw) } catch { return send(res, 400, { error: 'The request could not be read.' }) }
      const out = await runCleanChat(payload?.messages, {
        apiKey,
        model: env.GEMINI_MODEL,
        post: async (url, init) => {
          const r = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(140_000) })
          return { status: r.status, text: await r.text() }
        },
      })
      send(res, out.status, out.body)
    })
  },
}

// `npm run dev` only: answers /ai-page (the Studio's "AI Design assistant") the way the
// ai-event-page Edge Function does in production.
const aiPageDevPlugin = {
  name: 'nikadi-ai-page-dev',
  apply: 'serve',
  configureServer(server) {
    const env = { ...loadEnv(server.config.mode, server.config.envDir || server.config.root, ''), ...process.env }
    const send = (res, status, body) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    server.middlewares.use('/ai-page', async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
      const apiKey = String(env.GEMINI_API_KEY || '').trim()
      if (!apiKey) return send(res, 500, { error: 'No GEMINI_API_KEY — add it to .env.development.local (without VITE_) and restart npm run dev.' })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > PAGE_LIMITS.bodyBytes) return send(res, 413, { error: 'Request is too large.' })
      }
      let payload
      try { payload = JSON.parse(raw) } catch { return send(res, 400, { error: 'The request could not be read.' }) }
      const out = await runEventPageChat(payload?.messages, {
        apiKey,
        model: env.GEMINI_MODEL,
        post: async (url, init) => {
          const r = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(60_000) })
          return { status: r.status, text: await r.text() }
        },
      })
      send(res, out.status, out.body)
    })
  },
}

// `npm run dev` only: answers /ai-sms-draft (the SMS tab's "AI Draft SMS") the way the
// ai-sms-draft Edge Function does in production.
const aiSmsDraftDevPlugin = {
  name: 'nikadi-ai-sms-draft-dev',
  apply: 'serve',
  configureServer(server) {
    const env = { ...loadEnv(server.config.mode, server.config.envDir || server.config.root, ''), ...process.env }
    const send = (res, status, body) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    server.middlewares.use('/ai-sms-draft', async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
      const apiKey = String(env.GEMINI_API_KEY || '').trim()
      if (!apiKey) return send(res, 500, { error: 'No GEMINI_API_KEY — add it to .env.development.local (without VITE_) and restart npm run dev.' })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > SMS_DRAFT_LIMITS.bodyBytes) return send(res, 413, { error: 'Request is too large.' })
      }
      let payload
      try { payload = JSON.parse(raw) } catch { return send(res, 400, { error: 'The request could not be read.' }) }
      const out = await runSmsDraft(payload, {
        apiKey,
        model: env.GEMINI_MODEL,
        post: async (url, init) => {
          const r = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(60_000) })
          return { status: r.status, text: await r.text() }
        },
      })
      send(res, out.status, out.body)
    })
  },
}

export default defineConfig({
  base,
  plugins: [react(), siteUrlPlugin, aiCleanDevPlugin, aiPageDevPlugin, aiSmsDraftDevPlugin],
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

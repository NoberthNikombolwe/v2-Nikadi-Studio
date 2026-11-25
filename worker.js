/**
 * Cloudflare Worker — authentication, messaging proxies, AI helpers, scheduler,
 * delivery webhook, RSVP notifications and static asset server.
 *
 * Routes:
 *   GET  /api/session          CF Access email → Supabase session bootstrap
 *   *    /api/r2/*             R2 object storage write operations (auth required)
 *   GET  /files/*              R2 object storage public serving
 *   *    /proxy/sms/*          SMS API proxy  → messaging-service.co.tz
 *   *    /proxy/wa/*           WA API proxy   → messaging-service.co.tz
 *   POST /api/ai-clean         Gemini data-cleaning chat
 *   POST /ai-page              Gemini event-page design assistant
 *   POST /api/ai-sms-draft     Gemini SMS draft
 *   POST /api/delivery-webhook NextSMS delivery callback
 *   GET  /api/delivery-webhook Webhook reachability check
 *   POST /api/run-schedules    Manual/external schedule trigger (needs x-cron-secret)
 *   POST /api/notify-rsvp      RSVP WhatsApp notification (public)
 *   *    *                     Static Vite build (ASSETS binding)
 *
 * Cron triggers (wrangler.jsonc):
 *   "* * * * *"      run-schedules (every minute while sends are due)
 *   every-5-minutes  delivery sync (see wrangler.jsonc triggers)
 *
 * Worker secrets (Cloudflare dashboard → v2-nikadi-studio → Settings → Variables):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (never reaches the browser)
 *   SMS_BEARER_TOKEN          — NextSMS API token
 *   WA_BEARER_TOKEN           — WhatsApp API token (falls back to SMS_BEARER_TOKEN)
 *   GEMINI_API_KEY            — Google Gemini API key
 *   GEMINI_MODEL              — optional model override (default: gemini-flash-lite-latest)
 *   NEXTSMS_CALLBACK_TOKEN    — shared secret for delivery webhook verification
 *   CRON_SECRET               — shared secret for the HTTP run-schedules endpoint
 *   SMS_SENDER_ID             — optional default SMS sender ID
 */

import { createProxy, SMS_ROUTES, WA_ROUTES, cleanToken, UPSTREAM } from './workers/proxy.js'
import { handleDeliveryWebhook } from './workers/webhook.js'
import { createScheduler, runScheduler } from './workers/scheduler.js'
import { syncDeliveries } from './workers/deliveries.js'
import { serviceClient } from './workers/db.js'
import { runCleanChat, CLEAN_LIMITS } from './studio/supabase/functions/_shared/dataClean.js'
import { runEventPageChat, PAGE_LIMITS } from './studio/supabase/functions/_shared/aiEventPage.js'
import { runSmsDraft, SMS_DRAFT_LIMITS } from './studio/supabase/functions/_shared/aiSmsDraft.js'
import { RealtimeHub } from './durable-objects/RealtimeHub.js'
import { d1Client, d1Select, d1Insert, d1Update, d1Delete, d1Upsert, notifyDO } from './workers/d1.js'
import { RPC } from './workers/d1-rpc.js'
import { handleGoogleLogin, handleGoogleCallback, handleLogout, handleMe, getEmailFromSession } from './workers/auth.js'
export { RealtimeHub }

const smsProxy = createProxy({ mountPrefix: '/proxy/sms', tokenEnv: ['SMS_BEARER_TOKEN'], routes: SMS_ROUTES })
const waProxy  = createProxy({ mountPrefix: '/proxy/wa',  tokenEnv: ['WA_BEARER_TOKEN', 'SMS_BEARER_TOKEN'], routes: WA_ROUTES })
const scheduler = createScheduler()

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/session' && request.method === 'GET')
      return session(request, env)

    if (pathname.startsWith('/api/r2/'))
      return r2Write(request, env, pathname)

    if (pathname.startsWith('/files/'))
      return r2Serve(request, env, pathname)

    if (pathname.startsWith('/proxy/sms'))
      return smsProxy(request, env)

    if (pathname.startsWith('/proxy/wa'))
      return waProxy(request, env)

    if (pathname === '/api/ai-clean' && request.method === 'POST')
      return aiClean(request, env)

    if (pathname === '/ai-page' && request.method === 'POST')
      return aiPage(request, env)

    if (pathname === '/api/ai-sms-draft' && request.method === 'POST')
      return aiSmsDraft(request, env)

    if (pathname === '/auth/google')
      return handleGoogleLogin(request, env)

    if (pathname === '/auth/callback')
      return handleGoogleCallback(request, env)

    if (pathname === '/auth/logout')
      return handleLogout(request, env)

    if (pathname === '/api/me')
      return handleMe(request, env)

    if (pathname === '/api/delivery-webhook')
      return handleDeliveryWebhook(request, env)

    if (pathname === '/api/run-schedules' && request.method === 'POST')
      return scheduler(request, env)

    if (pathname === '/api/notify-rsvp')
      return notifyRsvp(request, env)

    if (pathname === '/api/realtime' && request.headers.get('Upgrade') === 'websocket')
      return realtimeConnect(request, env)

    if (pathname === '/api/realtime/notify' && request.method === 'POST')
      return realtimeNotify(request, env)

    // ── Cloudflare D1 data API ──────────────────────────────────────
    if (pathname === '/api/db' && request.method === 'POST')
      return handleD1(request, env)

    if (pathname.startsWith('/api/rpc/') && request.method === 'POST')
      return handleRpc(request, env, pathname.slice('/api/rpc/'.length))

    return env.ASSETS.fetch(request)
  },

  // Cloudflare Cron Triggers — fires every minute for schedules, every 5 min for deliveries.
  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      const db = serviceClient(env)
      if (db) ctx.waitUntil(syncDeliveries(db, env).catch(() => null))
    } else {
      ctx.waitUntil(runScheduler(env, null))
    }
  },
}

// ── Gemini AI helpers ──────────────────────────────────────────────────────────

const GEMINI_TIMEOUT_MS = 120_000

function geminiPost(url, init) {
  return fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) })
    .then(async r => ({ status: r.status, text: await r.text() }))
}

function requireAuth(request) {
  return request.headers.get('CF-Access-Authenticated-User-Email')
}

// Get authenticated email: CF Access header (if set) or D1 session cookie.
async function resolveEmail(request, env) {
  const cfEmail = request.headers.get('CF-Access-Authenticated-User-Email')
  if (cfEmail) return cfEmail.toLowerCase()
  return getEmailFromSession(request, env)
}

function jsonReply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function aiClean(request, env) {
  if (!requireAuth(request)) return jsonReply(401, { error: 'Sign in required' })
  const apiKey = cleanToken(env.GEMINI_API_KEY)
  if (!apiKey) return jsonReply(500, { error: 'The data cleaner is not set up (no GEMINI_API_KEY secret).' })
  if (Number(request.headers.get('content-length') ?? 0) > CLEAN_LIMITS.bodyBytes)
    return jsonReply(413, { error: 'That message is too large — send a shorter list or fewer photos.' })
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > CLEAN_LIMITS.bodyBytes)
    return jsonReply(413, { error: 'That message is too large — send a shorter list or fewer photos.' })
  let payload
  try { payload = JSON.parse(raw) } catch { return jsonReply(400, { error: 'The request could not be read.' }) }
  const out = await runCleanChat(payload?.messages, { apiKey, model: env.GEMINI_MODEL, post: geminiPost })
  return jsonReply(out.status, out.body)
}

async function aiPage(request, env) {
  if (!requireAuth(request)) return jsonReply(401, { error: 'Sign in required' })
  const apiKey = cleanToken(env.GEMINI_API_KEY)
  if (!apiKey) return jsonReply(500, { error: 'AI design assistant is not set up (no GEMINI_API_KEY secret).' })
  if (Number(request.headers.get('content-length') ?? 0) > PAGE_LIMITS.bodyBytes)
    return jsonReply(413, { error: 'Request is too large.' })
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > PAGE_LIMITS.bodyBytes)
    return jsonReply(413, { error: 'Request is too large.' })
  let payload
  try { payload = JSON.parse(raw) } catch { return jsonReply(400, { error: 'The request could not be read.' }) }
  const out = await runEventPageChat(payload?.messages, { apiKey, model: env.GEMINI_MODEL, post: geminiPost })
  return jsonReply(out.status, out.body)
}

async function aiSmsDraft(request, env) {
  if (!requireAuth(request)) return jsonReply(401, { error: 'Sign in required' })
  const apiKey = cleanToken(env.GEMINI_API_KEY)
  if (!apiKey) return jsonReply(500, { error: 'AI SMS draft is not set up (no GEMINI_API_KEY secret).' })
  if (Number(request.headers.get('content-length') ?? 0) > SMS_DRAFT_LIMITS.bodyBytes)
    return jsonReply(413, { error: 'Request is too large.' })
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > SMS_DRAFT_LIMITS.bodyBytes)
    return jsonReply(413, { error: 'Request is too large.' })
  let payload
  try { payload = JSON.parse(raw) } catch { return jsonReply(400, { error: 'The request could not be read.' }) }
  const out = await runSmsDraft(payload, { apiKey, model: env.GEMINI_MODEL, post: geminiPost })
  return jsonReply(out.status, out.body)
}

// ── RSVP notification (public — no auth check, fired by the guest page or SQL pg_net) ──────────

const WA_PATH = '/api/whatsapp/v2/text/single'

async function notifyRsvp(request, env) {
  if (request.method === 'OPTIONS') return new Response('ok', { status: 200 })
  if (request.method !== 'POST') return jsonReply(405, { error: 'Method not allowed' })

  const ch = { 'Content-Type': 'application/json' }
  const ok200 = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: ch })
  const err   = (status, msg) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: ch })

  let body
  try { body = await request.json() } catch { return err(400, 'Bad request') }

  const { event_public_id, guest_name, card_type, attending, message } = body
  if (!event_public_id) return err(400, 'Missing event_public_id')

  const db = serviceClient(env)
  if (!db) return err(500, 'Server not configured')

  try {
    const pubId = encodeURIComponent(event_public_id.toUpperCase())
    const events = await db.call(`events?select=id&public_id=eq.${pubId}&guest_link_enabled=eq.true&limit=1`)
    const eventId = events?.[0]?.id
    if (!eventId) return ok200()

    const pages = await db.call(`event_pages?select=rsvp_notify_phone&event_id=eq.${encodeURIComponent(eventId)}&limit=1`)
    const notifyPhone = pages?.[0]?.rsvp_notify_phone ?? null
    if (!notifyPhone) return ok200()

    const token = cleanToken(env.WA_BEARER_TOKEN ?? env.SMS_BEARER_TOKEN)
    if (!token) return ok200()

    const attendingLabel = attending ? 'Attending' : 'Not attending'
    const nameLabel = guest_name || 'Guest'
    const typeLabel = card_type ? ` (${card_type})` : ''
    let waText = `*RSVP Notification*\n${nameLabel}${typeLabel} - ${attendingLabel}`
    if (message) waText += `\nMessage: ${message}`

    await fetch(`${UPSTREAM}${WA_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: notifyPhone, message: waText }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { /* WA send failure is silent */ })
  } catch {
    // DB errors are silent — the guest's RSVP already succeeded
  }

  return ok200()
}

// ── R2 write operations ──────────────────────────────────────────────────────
async function r2Write(request, env, pathname) {
  const email = request.headers.get('CF-Access-Authenticated-User-Email')
  if (!email) return new Response('Unauthorized', { status: 401 })
  if (!env.R2) return new Response('R2 binding not configured', { status: 500 })

  const after  = pathname.slice('/api/r2/'.length)
  const slash  = after.indexOf('/')
  const bucket = slash === -1 ? after : after.slice(0, slash)
  const rest   = slash === -1 ? ''    : after.slice(slash + 1)

  if (rest === 'delete' && request.method === 'POST') {
    const { paths = [] } = await request.json()
    await Promise.all(paths.map(p => env.R2.delete(`${bucket}/${p}`)))
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
  }

  if (rest === 'list' && request.method === 'GET') {
    const prefix = new URL(request.url).searchParams.get('prefix') || ''
    const listed = await env.R2.list({ prefix: `${bucket}/${prefix}` })
    const objects = listed.objects.map(o => ({ name: o.key.slice(`${bucket}/`.length), size: o.size }))
    return new Response(JSON.stringify({ objects }), { headers: { 'Content-Type': 'application/json' } })
  }

  if (request.method === 'PUT' && rest) {
    const key = `${bucket}/${rest}`
    const ct  = request.headers.get('Content-Type') || 'application/octet-stream'
    await env.R2.put(key, request.body, { httpMetadata: { contentType: ct } })
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response('Not found', { status: 404 })
}

// ── R2 public file serving ────────────────────────────────────────────────────
async function r2Serve(request, env, pathname) {
  if (!env.R2) return new Response('R2 binding not configured', { status: 500 })
  const key = pathname.slice('/files/'.length)
  if (!key) return new Response('Not found', { status: 404 })
  const obj = await env.R2.get(key)
  if (!obj) return new Response('Not found', { status: 404 })
  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { headers })
}

// ── Realtime WebSocket proxy → Durable Object ────────────────────────────────

async function realtimeConnect(request, env) {
  const channel = new URL(request.url).searchParams.get('channel')
  if (!channel) return new Response('Missing channel', { status: 400 })
  if (!env.REALTIME_HUB) return new Response('Realtime not configured', { status: 503 })
  const id = env.REALTIME_HUB.idFromName(channel)
  const stub = env.REALTIME_HUB.get(id)
  return stub.fetch(request)
}

async function realtimeNotify(request, env) {
  const secret = request.headers.get('x-realtime-secret')
  if (!secret || secret !== env.REALTIME_SECRET)
    return new Response('Unauthorized', { status: 401 })
  if (!env.REALTIME_HUB) return new Response('ok', { status: 200 })
  const body = await request.text()
  let payload
  try { payload = JSON.parse(body) } catch { return new Response('Bad JSON', { status: 400 }) }
  const { channel } = payload
  if (!channel) return new Response('Missing channel', { status: 400 })
  const id = env.REALTIME_HUB.idFromName(channel)
  const stub = env.REALTIME_HUB.get(id)
  return stub.fetch(new Request('https://internal/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
}

// ── Cloudflare D1 CRUD API ────────────────────────────────────────────────────

// Public tables — no auth required (public scan / view pages use these via RPC)
const PUBLIC_RPC = new Set([
  'public_scan_event','public_find_cards','public_recent_scans','public_scan_stats',
  'public_view_event','public_view_guests','public_view_history',
  'server_time','scan_card',
])

async function handleD1(request, env) {
  if (!env.DB) return jsonReply(503, { message: 'D1 database not configured' })
  const email = await resolveEmail(request, env) || ''

  let body
  try { body = await request.json() } catch { return jsonReply(400, { message: 'Invalid JSON' }) }

  const { table, op = 'SELECT', select, filters, order, limit, offset, single, data, upsertOn } = body
  if (!table) return jsonReply(400, { message: 'Missing table' })

  // Auth: all table access requires a known active user
  if (email) {
    const user = await env.DB.prepare('SELECT active FROM app_users WHERE email = ?').bind(email).first()
    if (!user?.active) return jsonReply(403, { message: 'Access denied' })
  } else {
    return jsonReply(401, { message: 'Sign in required' })
  }

  try {
    const DB = env.DB
    let rows
    if (op === 'SELECT' || !op) {
      rows = await d1Select(DB, { table, select, filters, order, limit, offset })
    } else if (op === 'INSERT') {
      rows = await d1Insert(DB, { table, data })
      notifyDO(env, table, 'INSERT', rows)
    } else if (op === 'UPDATE') {
      rows = await d1Update(DB, { table, data, filters })
      notifyDO(env, table, 'UPDATE', rows)
    } else if (op === 'DELETE') {
      rows = await d1Delete(DB, { table, filters })
      notifyDO(env, table, 'DELETE', rows)
    } else if (op === 'UPSERT') {
      rows = await d1Upsert(DB, { table, data, onConflict: upsertOn })
      notifyDO(env, table, 'UPDATE', rows)
    } else {
      return jsonReply(400, { message: `Unknown op: ${op}` })
    }
    const result = single ? (rows[0] ?? null) : rows
    return jsonReply(200, result)
  } catch (e) {
    return jsonReply(400, { message: e.message })
  }
}

async function handleRpc(request, env, fn) {
  if (!fn) return jsonReply(400, { message: 'Missing function name' })
  const handler = RPC[fn]
  if (!handler) return jsonReply(404, { message: `Unknown RPC: ${fn}` })

  const email = await resolveEmail(request, env) || ''

  // Public RPCs don't require auth; all others do
  if (!PUBLIC_RPC.has(fn) && !email) return jsonReply(401, { message: 'Sign in required' })

  if (!PUBLIC_RPC.has(fn) && env.DB && email) {
    const user = await env.DB.prepare('SELECT active FROM app_users WHERE email = ?').bind(email).first()
    if (!user?.active) return jsonReply(403, { message: 'Access denied' })
  }

  let params = {}
  try { params = await request.json() } catch {}

  try {
    const result = await handler(env.DB, params, email, env)
    return jsonReply(200, result ?? null)
  } catch (e) {
    return jsonReply(400, { message: e.message })
  }
}

// ── Supabase session bootstrap ────────────────────────────────────────────────
async function session(request, env) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const email = request.headers.get('CF-Access-Authenticated-User-Email')?.toLowerCase()
  if (!email) return json({ error: 'cf_access_not_configured' }, 401)

  const sb = (path, opts = {}) =>
    fetch(`${env.SUPABASE_URL}${path}`, {
      ...opts,
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
      },
    })

  const checkResp = await sb(`/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=email,active`)
  if (!checkResp.ok) return json({ error: 'db_error' }, 500)
  const [appUser] = await checkResp.json()
  if (!appUser?.active) return json({ error: 'not_invited' }, 403)

  const listResp = await sb('/auth/v1/admin/users?per_page=1000')
  let sbUserId = null
  if (listResp.ok) {
    const { users = [] } = await listResp.json()
    sbUserId = users.find(u => u.email?.toLowerCase() === email)?.id ?? null
  }

  if (!sbUserId) {
    const createResp = await sb('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { provider: 'cloudflare_access' } }),
    })
    if (!createResp.ok) {
      const err = await createResp.text()
      return json({ error: 'user_creation_failed', detail: err }, 500)
    }
    sbUserId = (await createResp.json())?.id
  }

  if (!sbUserId) return json({ error: 'user_setup_failed' }, 500)

  const sessResp = await sb(`/auth/v1/admin/users/${sbUserId}/session`, { method: 'POST', body: '{}' })
  if (!sessResp.ok) {
    const err = await sessResp.text()
    return json({ error: 'session_creation_failed', detail: err }, 500)
  }

  return new Response(await sessResp.text(), { headers: { 'Content-Type': 'application/json' } })
}

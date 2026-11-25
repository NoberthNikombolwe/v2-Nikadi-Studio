// SMS / WhatsApp proxy factory — ported from supabase/functions/_shared/proxy.ts.
// Deno.env removed; call createProxy(opts)(request, env) instead of Deno.serve(createProxy(opts)).
//
// Routes:
//   SMS:  Worker mounts at /proxy/sms  → strips prefix → forwards to messaging-service.co.tz
//   WA:   Worker mounts at /proxy/wa   → strips prefix → forwards to messaging-service.co.tz
//
// Auth: CF Access guarantees the user is signed in; we just check the email header is present.
// The client's Authorization header is ignored; the provider token comes from env secrets.

export const UPSTREAM = 'https://messaging-service.co.tz'
const MAX_BODY_BYTES = 1_000_000
const UPSTREAM_TIMEOUT_MS = 25_000

// Strip surrounding quotes and "Bearer " prefix that sometimes leak in when secrets are pasted.
export const cleanToken = (v) =>
  String(v ?? '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/^bearer\s+/i, '').trim()

const jsonReply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// opts: { mountPrefix, tokenEnv, routes }
//   mountPrefix — e.g. "/proxy/sms" — stripped to get the upstream path
//   tokenEnv    — array of env key names; first non-empty value is used
//   routes      — [{ method, path }] exact-match allowlist
export const createProxy = ({ mountPrefix, tokenEnv, routes }) =>
  async (request, env) => {
    if (request.method === 'OPTIONS') return new Response('ok', { status: 200 })

    // CF Access sets this after the user authenticates with Google.
    const email = request.headers.get('CF-Access-Authenticated-User-Email')
    if (!email) return jsonReply(401, { error: 'Sign in required' })

    const url = new URL(request.url)
    const upstreamPath = url.pathname.slice(mountPrefix.length) || '/'

    const route = routes.find(r => r.path === upstreamPath && r.method === request.method)
    if (!route) return jsonReply(404, { error: 'Unknown endpoint' })

    const token = tokenEnv.map(k => cleanToken(env[k])).find(Boolean)
    if (!token) return jsonReply(500, { error: 'Server is not configured' })

    let body
    if (request.method === 'POST') {
      if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
        return jsonReply(413, { error: 'Request too large' })
      body = await request.text()
      if (body.length > MAX_BODY_BYTES) return jsonReply(413, { error: 'Request too large' })
    }

    try {
      const upstream = await fetch(`${UPSTREAM}${upstreamPath}${url.search}`, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      return jsonReply(502, { error: 'Upstream request failed' })
    }
  }

export const SMS_ROUTES = [
  { method: 'POST', path: '/api/sms/v2/text/single' },
  { method: 'POST', path: '/api/sms/v2/text/multi' },
  { method: 'GET',  path: '/api/v2/balance' },
  { method: 'GET',  path: '/api/v2/reports' },
  { method: 'GET',  path: '/api/v2/logs' },
]

export const WA_ROUTES = [
  { method: 'POST', path: '/api/whatsapp/v2/text/single' },
  { method: 'GET',  path: '/api/v2/reports' },
]

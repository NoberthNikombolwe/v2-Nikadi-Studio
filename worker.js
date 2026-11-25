/**
 * Cloudflare Worker — authentication bridge + static asset server.
 *
 * GET /api/session  Reads the CF Access email header, verifies the user is
 *                   invited in app_users, and returns a Supabase session so
 *                   the browser can talk to the database directly (RLS intact).
 * Everything else   Served from the static Vite build via the ASSETS binding.
 *
 * Secrets (Cloudflare dashboard → v2-nikadi-studio → Settings → Variables):
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (never reaches the browser)
 */

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/session' && request.method === 'GET') {
      return session(request, env)
    }

    // R2 write endpoints (upload, delete, list) — require CF Access auth
    if (pathname.startsWith('/api/r2/')) {
      return r2Write(request, env, pathname)
    }

    // Public file serving from R2 — no auth required
    if (pathname.startsWith('/files/')) {
      return r2Serve(request, env, pathname)
    }

    return env.ASSETS.fetch(request)
  },
}

// ── R2 write operations ──────────────────────────────────────────────────────
// All writes require CF Access authentication (the email header must be set).
async function r2Write(request, env, pathname) {
  const email = request.headers.get('CF-Access-Authenticated-User-Email')
  if (!email) return new Response('Unauthorized', { status: 401 })
  if (!env.R2) return new Response('R2 binding not configured', { status: 500 })

  // pathname: /api/r2/{bucket}[/...rest]
  const after  = pathname.slice('/api/r2/'.length)      // "wa-cards/wa/xxx.jpg"
  const slash  = after.indexOf('/')
  const bucket = slash === -1 ? after : after.slice(0, slash)
  const rest   = slash === -1 ? ''    : after.slice(slash + 1)

  // DELETE: POST /api/r2/{bucket}/delete  body: { paths: string[] }
  if (rest === 'delete' && request.method === 'POST') {
    const { paths = [] } = await request.json()
    await Promise.all(paths.map(p => env.R2.delete(`${bucket}/${p}`)))
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
  }

  // LIST: GET /api/r2/{bucket}/list?prefix=…
  if (rest === 'list' && request.method === 'GET') {
    const prefix = new URL(request.url).searchParams.get('prefix') || ''
    const listed = await env.R2.list({ prefix: `${bucket}/${prefix}` })
    const objects = listed.objects.map(o => ({
      name: o.key.slice(`${bucket}/`.length),
      size: o.size,
    }))
    return new Response(JSON.stringify({ objects }), { headers: { 'Content-Type': 'application/json' } })
  }

  // UPLOAD: PUT /api/r2/{bucket}/{...path}
  if (request.method === 'PUT' && rest) {
    const key = `${bucket}/${rest}`
    const ct  = request.headers.get('Content-Type') || 'application/octet-stream'
    await env.R2.put(key, request.body, { httpMetadata: { contentType: ct } })
    return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response('Not found', { status: 404 })
}

// ── R2 public file serving ────────────────────────────────────────────────────
// GET /files/{bucket}/{...path} — serves any object from R2 without auth.
// Used as the public URL fallback when VITE_R2_PUBLIC_URL is not set.
async function r2Serve(request, env, pathname) {
  if (!env.R2) return new Response('R2 binding not configured', { status: 500 })
  const key = pathname.slice('/files/'.length)   // "wa-cards/wa/xxx.jpg"
  if (!key) return new Response('Not found', { status: 404 })
  const obj = await env.R2.get(key)
  if (!obj) return new Response('Not found', { status: 404 })
  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { headers })
}

// ── Supabase session bootstrap ────────────────────────────────────────────────
async function session(request, env) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  // CF Access sets this header after the user authenticates with Google.
  const email = request.headers.get('CF-Access-Authenticated-User-Email')?.toLowerCase()
  if (!email) return json({ error: 'cf_access_not_configured' }, 401)

  // Helper: call Supabase REST / Auth APIs with the service-role key.
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

  // 1. Confirm the user is invited and active.
  const checkResp = await sb(
    `/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=email,active`
  )
  if (!checkResp.ok) return json({ error: 'db_error' }, 500)
  const [appUser] = await checkResp.json()
  if (!appUser?.active) return json({ error: 'not_invited' }, 403)

  // 2. Find the matching Supabase Auth user.
  //    Lists up to 1 000 auth users (fine for an internal team tool).
  const listResp = await sb('/auth/v1/admin/users?per_page=1000')
  let sbUserId = null
  if (listResp.ok) {
    const { users = [] } = await listResp.json()
    sbUserId = users.find(u => u.email?.toLowerCase() === email)?.id ?? null
  }

  // 3. No Supabase Auth account yet — create one (email pre-confirmed).
  if (!sbUserId) {
    const createResp = await sb('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { provider: 'cloudflare_access' },
      }),
    })
    if (!createResp.ok) {
      const err = await createResp.text()
      return json({ error: 'user_creation_failed', detail: err }, 500)
    }
    sbUserId = (await createResp.json())?.id
  }

  if (!sbUserId) return json({ error: 'user_setup_failed' }, 500)

  // 4. Create a Supabase session for the user.
  //    The browser stores these tokens; RLS sees the correct auth.uid().
  const sessResp = await sb(`/auth/v1/admin/users/${sbUserId}/session`, {
    method: 'POST',
    body: '{}',
  })
  if (!sessResp.ok) {
    const err = await sessResp.text()
    return json({ error: 'session_creation_failed', detail: err }, 500)
  }

  return new Response(await sessResp.text(), {
    headers: { 'Content-Type': 'application/json' },
  })
}

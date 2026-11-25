// Google OAuth 2.0 flow — no Supabase, no external auth library.
// Secrets required:  GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET
//
// Routes handled by worker.js:
//   GET  /auth/google    — redirect to Google consent screen
//   GET  /auth/callback  — exchange code, create D1 session, set cookie
//   POST /auth/logout    — delete session, clear cookie
//   GET  /api/me         — return { email } for the current session

const SESSION_DAYS = 7
const COOKIE_NAME  = 'nk_session'

// ── Helpers ───────────────────────────────────────────────────────────────────

function cookieHeader(token, maxAge) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

function getToken(request) {
  const cookie = request.headers.get('Cookie') || ''
  return cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1] || null
}

function origin(request) {
  const u = new URL(request.url)
  return `${u.protocol}//${u.host}`
}

// ── Session D1 helpers ────────────────────────────────────────────────────────

export async function getEmailFromSession(request, env) {
  const token = getToken(request)
  if (!token || !env.DB) return null
  const row = await env.DB
    .prepare("SELECT email FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token).first()
  return row?.email || null
}

async function createSession(DB, email) {
  const token = crypto.randomUUID()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  await DB.prepare('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)')
    .bind(token, email, expires).run()
  return { token, maxAge: SESSION_DAYS * 86400 }
}

// ── Route handlers ────────────────────────────────────────────────────────────

export function handleGoogleLogin(request, env) {
  if (!env.GOOGLE_CLIENT_ID)
    return new Response('GOOGLE_CLIENT_ID secret is not set', { status: 500 })

  // Generate and store a random state to prevent CSRF
  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${origin(request)}/auth/callback`,
    response_type: 'code',
    scope:         'email profile',
    access_type:   'online',
    prompt:        'select_account',
    state,
  })
  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    // Store state in a short-lived cookie for CSRF check on callback
    'Set-Cookie': `nk_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=600`,
  })
  return new Response(null, { status: 302, headers })
}

export async function handleGoogleCallback(request, env) {
  const url    = new URL(request.url)
  const code   = url.searchParams.get('code')
  const state  = url.searchParams.get('state')
  const err    = url.searchParams.get('error')
  const base   = origin(request)

  if (err) return Response.redirect(`${base}/?auth_error=${encodeURIComponent(err)}`, 302)
  if (!code) return Response.redirect(`${base}/?auth_error=no_code`, 302)

  // CSRF: verify state matches what we stored
  const storedState = (request.headers.get('Cookie') || '').match(/nk_oauth_state=([^;]+)/)?.[1]
  if (!storedState || storedState !== state)
    return Response.redirect(`${base}/?auth_error=state_mismatch`, 302)

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return Response.redirect(`${base}/?auth_error=server_misconfigured`, 302)

  // Exchange code for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${base}/auth/callback`,
      grant_type:    'authorization_code',
    }),
  })
  if (!tokenRes.ok)
    return Response.redirect(`${base}/?auth_error=token_exchange_failed`, 302)

  const { access_token } = await tokenRes.json()

  // Fetch the user's email from Google
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!infoRes.ok)
    return Response.redirect(`${base}/?auth_error=userinfo_failed`, 302)

  const { email: rawEmail } = await infoRes.json()
  const email = rawEmail?.toLowerCase()
  if (!email)
    return Response.redirect(`${base}/?auth_error=no_email`, 302)

  // Check app_users
  if (env.DB) {
    const user = await env.DB
      .prepare('SELECT active FROM app_users WHERE email = ?')
      .bind(email).first()
    if (!user?.active)
      return Response.redirect(`${base}/?auth_error=not_authorized`, 302)
  }

  // Create session
  const { token, maxAge } = await createSession(env.DB, email)

  const headers = new Headers({
    Location: base + '/',
    'Set-Cookie': cookieHeader(token, maxAge),
  })
  // Clear the oauth-state cookie
  headers.append('Set-Cookie', 'nk_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=0')
  return new Response(null, { status: 302, headers })
}

export async function handleLogout(request, env) {
  const token = getToken(request)
  if (token && env.DB) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run().catch(() => null)
  }
  const headers = new Headers({
    Location: origin(request) + '/',
    'Set-Cookie': cookieHeader('', 0),
  })
  return new Response(null, { status: 302, headers })
}

export async function handleMe(request, env) {
  const email = await getEmailFromSession(request, env)
  if (!email) return new Response(JSON.stringify({ email: null }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  return new Response(JSON.stringify({ email }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

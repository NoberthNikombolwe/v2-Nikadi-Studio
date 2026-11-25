// Shared DB utilities for Workers — ported from supabase/functions/_shared/db.ts.
// Deno.env removed; pass env object where the original used Deno.env.

const DB_TIMEOUT_MS = 15_000

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Constant-time comparison so timing attacks can't probe secrets.
export const sameSecret = (a, b) => {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const clip = (v, max) =>
  (v === undefined || v === null || v === '' ? null : String(v).slice(0, max))

// PostgREST client using service-role key (never touches user JWTs).
export const restClient = (url, key) => {
  const call = async (path, init = {}, prefer) => {
    const { headers: _ignored, ...rest } = init   // headers always come from key below
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...rest,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Database error ${res.status}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  const rpc = (fn, args) => call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
  return { call, rpc }
}

// Returns a client or null when secrets are missing.
export const serviceClient = (env) => {
  const url = env?.SUPABASE_URL
  const key = env?.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? restClient(url, key) : null
}

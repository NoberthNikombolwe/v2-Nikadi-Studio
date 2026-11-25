// Cloudflare Worker WebSocket channel — drop-in replacement for supabase.channel().
//
// In production the app is served from the same origin as the Worker, so the
// WebSocket connects directly.  In dev Vite can't proxy WebSockets, so we
// return null and callers fall back to supabase.channel() as before.
//
// Usage:
//   const rt = cfChannel('deliveries:event-uuid')
//   if (rt) {
//     rt.on(payload => { /* { eventType, table, new, old } */ }).subscribe()
//     return () => rt.unsubscribe()
//   }
//   // ...supabase.channel() fallback...

export function cfChannel(name) {
  if (import.meta.env.DEV) return null

  let handler = null
  let ws = null
  let timer = null
  let closed = false

  const connect = () => {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    try {
      ws = new WebSocket(`${proto}//${location.host}/api/realtime?channel=${encodeURIComponent(name)}`)
      ws.onmessage = (e) => {
        try { handler?.(JSON.parse(e.data)) } catch {}
      }
      ws.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000)
      }
      ws.onerror = () => { try { ws.close() } catch {} }
    } catch {}
  }

  return {
    on(fn) { handler = fn; return this },
    subscribe() { connect(); return this },
    unsubscribe() {
      closed = true
      clearTimeout(timer)
      try { ws?.close() } catch {}
    },
  }
}

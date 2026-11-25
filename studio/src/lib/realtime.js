// Cloudflare Worker WebSocket channel — replaces supabase.channel() entirely.
//
// In production: connects via WebSocket to the Worker's Durable Object hub at
// /api/realtime?channel=<name>. Reconnects automatically on disconnect.
//
// In dev (Vite on :5173): returns a silent no-op channel — no realtime updates,
// no errors. Run `npx wrangler dev` alongside Vite if live updates are needed in dev.
//
// Usage:
//   const rt = cfChannel('deliveries:event-uuid')
//   rt.on(payload => { /* { eventType, table, new, old } */ }).subscribe()
//   return () => rt.unsubscribe()

export function cfChannel(name) {
  if (import.meta.env.DEV) {
    return { on() { return this }, subscribe() { return this }, unsubscribe() {} }
  }

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

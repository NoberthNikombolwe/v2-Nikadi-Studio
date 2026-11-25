// Durable Object — one instance per channel (e.g. "deliveries:event-id").
//
// Architecture:
//   Browser WebSocket → DO → Supabase Realtime WebSocket (service role)
//
// When the first browser client connects the DO opens one outbound WebSocket to
// Supabase Realtime, subscribes to postgres_changes on the right table(s), and
// fans the change events out to every connected browser.  When all browsers
// disconnect the upstream connection is closed and the DO can be garbage-collected.
//
// This requires ZERO SQL changes on Supabase — no pg_net triggers, no SQL Editor.
// The DO bridges the existing Supabase Realtime infrastructure into Cloudflare.
//
// A direct POST to the DO (from worker.js after a Worker-initiated write) is also
// accepted so Worker-sourced mutations appear live without waiting for the
// Supabase Realtime round-trip.

export class RealtimeHub {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.sessions = new Set()   // active browser WebSocket connections
    this.upstream = null        // outbound WebSocket to Supabase Realtime
    this.heartbeat = null
    this.ref = 1
    this.channel = null
    this.reconnecting = false
  }

  async fetch(request) {
    const url = new URL(request.url)

    // ── Browser WebSocket upgrade ──────────────────────────────────────────
    if (request.headers.get('Upgrade') === 'websocket') {
      const channelName = url.searchParams.get('channel')
      if (!channelName) return new Response('Missing channel', { status: 400 })

      const { 0: client, 1: server } = new WebSocketPair()
      server.accept()
      this.sessions.add(server)

      server.addEventListener('close', () => {
        this.sessions.delete(server)
        if (this.sessions.size === 0) this._closeUpstream()
      })
      server.addEventListener('error', () => this.sessions.delete(server))
      // browser clients are read-only — ignore any inbound messages

      // Open upstream connection when the first browser client arrives
      if (this.sessions.size === 1) {
        this.channel = channelName
        this._connectUpstream()
      }

      return new Response(null, { status: 101, webSocket: client })
    }

    // ── Direct push from worker.js (Worker-initiated writes) ───────────────
    if (request.method === 'POST') {
      const body = await request.text()
      this._broadcast(body)
      return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
    }

    return new Response('Not found', { status: 404 })
  }

  // ── Supabase Realtime upstream ───────────────────────────────────────────

  _connectUpstream() {
    const sbUrl = this.env.SUPABASE_URL
    const sbKey = this.env.SUPABASE_SERVICE_ROLE_KEY
    if (!sbUrl || !sbKey) return

    const wsUrl = `${sbUrl.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${sbKey}&vsn=1.0.0`

    try { this.upstream = new WebSocket(wsUrl) } catch { return }

    this.upstream.addEventListener('open', () => {
      this._subscribe()
      // Supabase Realtime requires a heartbeat every ≤ 30 s
      this.heartbeat = setInterval(() => {
        if (this.upstream?.readyState === 1) {
          this.upstream.send(JSON.stringify({
            topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(this.ref++),
          }))
        } else {
          clearInterval(this.heartbeat)
          this.heartbeat = null
        }
      }, 25_000)
    })

    this.upstream.addEventListener('message', ({ data }) => {
      try {
        const msg = JSON.parse(data)
        if (msg.event !== 'postgres_changes') return
        const { type: eventType, record, old_record, table } = msg.payload?.data || {}
        this._broadcast(JSON.stringify({
          channel: this.channel,
          table,
          eventType,
          new: record   || null,
          old: old_record || null,
        }))
      } catch {}
    })

    this.upstream.addEventListener('close', () => {
      clearInterval(this.heartbeat)
      this.heartbeat = null
      this.upstream = null
      // Reconnect only if browser clients are still waiting
      if (this.sessions.size > 0 && !this.reconnecting) {
        this.reconnecting = true
        setTimeout(() => { this.reconnecting = false; this._connectUpstream() }, 3000)
      }
    })

    this.upstream.addEventListener('error', () => {
      try { this.upstream?.close() } catch {}
    })
  }

  _subscribe() {
    const subs = this._subs(this.channel)
    if (!subs.length) return
    const joinRef = String(this.ref++)
    this.upstream.send(JSON.stringify({
      topic: `realtime:${this.channel}`,
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { self: false },
          presence:  { key: '' },
          postgres_changes: subs,
        },
      },
      ref: String(this.ref++),
      join_ref: joinRef,
    }))
  }

  _subs(channel) {
    if (!channel) return []
    if (channel.startsWith('deliveries:')) {
      const eid = channel.slice(11)
      return [{ event: '*', schema: 'public', table: 'message_deliveries', filter: `event_id=eq.${eid}` }]
    }
    if (channel.startsWith('cards:')) {
      const eid = channel.slice(6)
      return [{ event: '*', schema: 'public', table: 'event_cards', filter: `event_id=eq.${eid}` }]
    }
    if (channel.startsWith('schedules:')) {
      const eid = channel.slice(10)
      return [
        { event: '*', schema: 'public', table: 'message_schedules',      filter: `event_id=eq.${eid}` },
        { event: '*', schema: 'public', table: 'message_schedule_runs',   filter: `event_id=eq.${eid}` },
      ]
    }
    if (channel === 'schedules-all') {
      return [
        { event: '*', schema: 'public', table: 'message_schedules' },
        { event: '*', schema: 'public', table: 'message_schedule_runs' },
      ]
    }
    return []
  }

  _broadcast(json) {
    for (const ws of this.sessions) {
      try { ws.send(json) } catch { this.sessions.delete(ws) }
    }
  }

  _closeUpstream() {
    clearInterval(this.heartbeat)
    this.heartbeat = null
    try { this.upstream?.close() } catch {}
    this.upstream = null
  }
}

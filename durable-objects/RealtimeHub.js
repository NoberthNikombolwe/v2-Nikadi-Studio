// Durable Object — one instance per channel (e.g. "deliveries:event-id").
// Maintains WebSocket connections and broadcasts change payloads.
// Uses the Hibernatable WebSockets API so the DO sleeps when there are no clients
// and wakes up only when a message arrives, minimising billing.

export class RealtimeHub {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    const upgrade = request.headers.get('Upgrade')

    // WebSocket upgrade from the browser
    if (upgrade === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.state.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    // Push notification from the Worker (called by SQL triggers via pg_net)
    if (request.method === 'POST') {
      const payload = await request.json()
      const json = JSON.stringify(payload)
      let count = 0
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(json); count++ } catch { /* ignore disconnected clients */ }
      }
      return new Response(JSON.stringify({ ok: true, clients: count }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  webSocketClose() { /* hibernation handles cleanup */ }
  webSocketError() { /* hibernation handles cleanup */ }
  webSocketMessage() { /* clients are read-only — no inbound messages needed */ }
}

// Cloudflare D1 browser client — identical interface to the Supabase JS client.
// In production the app sends requests to the Worker's /api/db and /api/rpc/:fn
// endpoints; in dev the imported supabase.js re-exports the real Supabase client
// so this file is never loaded at runtime there.
//
// Usage (identical to supabase-js):
//   const { data, error } = await db.from('events').select('*').eq('id', id).single()
//   const { data, error } = await db.from('event_cards').insert(row).select()
//   const { data, error } = await db.rpc('scan_card', { p_code: code })

class Query {
  constructor(table) {
    this._table   = table
    this._select  = '*'
    this._filters = []
    this._order   = []
    this._limit   = null
    this._offset  = null
    this._single  = false
    this._maybe   = false
    this._op      = 'SELECT'
    this._data    = null
    this._upsertOn = null
  }

  // ── Column selector ──────────────────────────────────────────────
  select(cols) { this._select = cols || '*'; return this }

  // ── Filters ──────────────────────────────────────────────────────
  eq(col, val)       { this._filters.push({ col, op: 'eq',   val }); return this }
  neq(col, val)      { this._filters.push({ col, op: 'neq',  val }); return this }
  gt(col, val)       { this._filters.push({ col, op: 'gt',   val }); return this }
  gte(col, val)      { this._filters.push({ col, op: 'gte',  val }); return this }
  lt(col, val)       { this._filters.push({ col, op: 'lt',   val }); return this }
  lte(col, val)      { this._filters.push({ col, op: 'lte',  val }); return this }
  in(col, vals)      { this._filters.push({ col, op: 'in',   val: vals }); return this }
  is(col, val)       { this._filters.push({ col, op: 'is',   val }); return this }
  not(col, op, val)  { this._filters.push({ col, op: `not.${op}`, val }); return this }
  ilike(col, val)    { this._filters.push({ col, op: 'ilike', val }); return this }
  like(col, val)     { this._filters.push({ col, op: 'like',  val }); return this }
  contains(col, val) { this._filters.push({ col, op: 'ilike', val: `%${val}%` }); return this }
  match(obj)         { Object.entries(obj).forEach(([col, val]) => this.eq(col, val)); return this }

  // ── Modifiers ────────────────────────────────────────────────────
  order(col, { ascending = true } = {}) { this._order.push({ col, asc: ascending }); return this }
  limit(n)           { this._limit = n; return this }
  range(from, to)    { this._offset = from; this._limit = to - from + 1; return this }
  single()           { this._single = true; this._limit = 1; return this }
  maybeSingle()      { this._maybe = true; this._limit = 1; return this }

  // ── Writes ───────────────────────────────────────────────────────
  insert(data, _opts) { this._op = 'INSERT'; this._data = data; return this }
  update(data)        { this._op = 'UPDATE'; this._data = data; return this }
  delete()            { this._op = 'DELETE'; return this }
  upsert(data, { onConflict } = {}) { this._op = 'UPSERT'; this._data = data; this._upsertOn = onConflict; return this }

  // ── Execute ──────────────────────────────────────────────────────
  async _run() {
    const payload = {
      table:     this._table,
      op:        this._op,
      select:    this._select,
      filters:   this._filters,
      order:     this._order,
      limit:     this._limit,
      offset:    this._offset,
      single:    this._single || this._maybe,
      data:      this._data,
      upsertOn:  this._upsertOn,
    }
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) return { data: null, error: body }
      return { data: body, error: null }
    } catch (e) {
      return { data: null, error: { message: e.message || 'Network error' } }
    }
  }

  // Makes `await query` work (thenable) ────────────────────────────
  then(resolve, reject) { return this._run().then(resolve, reject) }
}

// ── Top-level client ───────────────────────────────────────────────────────────

export const db = {
  from: (table) => new Query(table),

  rpc: async (fn, params = {}) => {
    try {
      const res  = await fetch(`/api/rpc/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const body = await res.json()
      return res.ok ? { data: body, error: null } : { data: null, error: body }
    } catch (e) {
      return { data: null, error: { message: e.message || 'Network error' } }
    }
  },

  // Auth — backed by Worker session cookie (no Supabase)
  auth: {
    getSession: async () => {
      try {
        const res = await fetch('/api/me')
        const { email } = await res.json()
        if (!email) return { data: { session: null }, error: null }
        return { data: { session: { user: { id: email, email } } }, error: null }
      } catch {
        return { data: { session: null }, error: null }
      }
    },
    setSession:  async () => ({ data: { session: null }, error: null }),
    signOut:     async () => { window.location.href = '/auth/logout'; return { error: null } },
    onAuthStateChange: (cb) => {
      fetch('/api/me').then(r => r.json()).then(({ email }) => {
        if (email) cb('SIGNED_IN', { user: { id: email, email } })
        else cb('SIGNED_OUT', null)
      }).catch(() => cb('SIGNED_OUT', null))
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
    signInWithOAuth: async () => {
      window.location.href = '/auth/google'
      return { error: null }
    },
  },

  // realtime is handled via cfChannel() — these are no-ops ─────────
  channel:        () => ({ on: () => {}, subscribe: () => {} }),
  removeChannel:  () => {},

  // storage stubs (R2 handled separately via /api/r2/*) ────────────
  storage: {
    from: () => ({
      upload:      async () => ({ data: null, error: { message: 'Use /api/r2/' } }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      remove:       async () => ({ data: null, error: null }),
      list:         async () => ({ data: [], error: null }),
    }),
  },
}

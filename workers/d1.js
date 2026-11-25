// Cloudflare D1 (SQLite) query builder and CRUD helpers for Worker code.
// All writes on realtime-tracked tables push a notification to the RealtimeHub DO.

const ALLOWED = new Set([
  'events','event_cards','event_logs','customers','leads','lead_followups',
  'finance_accounts','event_transactions','saved_templates','app_roles','app_modules',
  'role_permissions','app_users','app_settings','wa_templates','sender_ids',
  'card_type_rules','scan_logs','event_assignments','event_pages',
  'message_schedules','message_schedule_runs','message_run_targets',
  'message_deliveries','app_feedback',
])

function safeId(col) {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(col)) throw new Error(`Invalid column: ${col}`)
  return col
}

function buildWhere(filters) {
  if (!Array.isArray(filters) || !filters.length) return { sql: '', bind: [] }
  const parts = [], bind = []
  for (const f of filters) {
    const col = safeId(f.col)
    switch (f.op) {
      case 'eq':
        if (f.val === null) { parts.push(`${col} IS NULL`); break }
        parts.push(`${col} = ?`); bind.push(f.val); break
      case 'neq':
        parts.push(`${col} != ?`); bind.push(f.val); break
      case 'gt':  parts.push(`${col} > ?`);  bind.push(f.val); break
      case 'gte': parts.push(`${col} >= ?`); bind.push(f.val); break
      case 'lt':  parts.push(`${col} < ?`);  bind.push(f.val); break
      case 'lte': parts.push(`${col} <= ?`); bind.push(f.val); break
      case 'in':
        if (!Array.isArray(f.val) || !f.val.length) { parts.push('0=1'); break }
        parts.push(`${col} IN (${f.val.map(() => '?').join(',')})`)
        bind.push(...f.val); break
      case 'is':
        parts.push(`${col} IS ${f.val === null ? 'NULL' : f.val ? '1' : '0'}`); break
      case 'not.is':
        parts.push(`${col} IS NOT ${f.val === null ? 'NULL' : f.val ? '1' : '0'}`); break
      case 'ilike':
        parts.push(`LOWER(${col}) LIKE LOWER(?)`); bind.push(f.val); break
      case 'like':
        parts.push(`${col} LIKE ?`); bind.push(f.val); break
      default: break
    }
  }
  return { sql: parts.length ? ' WHERE ' + parts.join(' AND ') : '', bind }
}

function buildOrder(order) {
  if (!Array.isArray(order) || !order.length) return ''
  return ' ORDER BY ' + order.map(o => `${safeId(o.col)} ${o.asc === false ? 'DESC' : 'ASC'}`).join(', ')
}

function colList(select) {
  if (!select || select === '*') return '*'
  return select.split(',').map(c => {
    const t = c.trim()
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(t)) throw new Error(`Bad col: ${t}`)
    return t
  }).join(', ')
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function d1Select(DB, { table, select, filters, order, limit, offset }) {
  if (!ALLOWED.has(table)) throw new Error(`Unknown table: ${table}`)
  const { sql: w, bind } = buildWhere(filters)
  let sql = `SELECT ${colList(select)} FROM ${table}${w}${buildOrder(order)}`
  if (limit  != null) sql += ` LIMIT ${parseInt(limit)}`
  if (offset != null) sql += ` OFFSET ${parseInt(offset)}`
  return (await DB.prepare(sql).bind(...bind).all()).results
}

export async function d1Insert(DB, { table, data, returning = true }) {
  if (!ALLOWED.has(table)) throw new Error(`Unknown table: ${table}`)
  const rows = Array.isArray(data) ? data : [data]
  const out = []
  for (const raw of rows) {
    const r = { ...raw }
    if (!r.id) r.id = crypto.randomUUID()
    const now = new Date().toISOString()
    if (!r.created_at) r.created_at = now
    if (!r.updated_at && table !== 'event_logs' && table !== 'lead_followups' && table !== 'scan_logs') r.updated_at = now
    const cols = Object.keys(r).filter(k => r[k] !== undefined)
    const vals = cols.map(k => typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : r[k] === undefined ? null : r[k])
    const ret = returning ? ' RETURNING *' : ''
    const res = await DB.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})${ret}`
    ).bind(...vals).all()
    out.push(res.results?.[0] ?? r)
  }
  return out
}

export async function d1Update(DB, { table, data, filters, returning = true }) {
  if (!ALLOWED.has(table)) throw new Error(`Unknown table: ${table}`)
  const { sql: w, bind: wb } = buildWhere(filters)
  if (!w) throw new Error('UPDATE without filter not allowed')
  const patch = { ...data, updated_at: new Date().toISOString() }
  delete patch.id; delete patch.created_at
  const cols = Object.keys(patch).filter(k => patch[k] !== undefined)
  if (!cols.length) return []
  const vals = cols.map(k => typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k])
  const set  = cols.map(c => `${c} = ?`).join(', ')
  const ret  = returning ? ' RETURNING *' : ''
  return (await DB.prepare(`UPDATE ${table} SET ${set}${w}${ret}`).bind(...vals, ...wb).all()).results
}

export async function d1Delete(DB, { table, filters, returning = true }) {
  if (!ALLOWED.has(table)) throw new Error(`Unknown table: ${table}`)
  const { sql: w, bind } = buildWhere(filters)
  if (!w) throw new Error('DELETE without filter not allowed')
  const ret = returning ? ' RETURNING *' : ''
  return (await DB.prepare(`DELETE FROM ${table}${w}${ret}`).bind(...bind).all()).results
}

export async function d1Upsert(DB, { table, data, onConflict = 'id' }) {
  if (!ALLOWED.has(table)) throw new Error(`Unknown table: ${table}`)
  const rows = Array.isArray(data) ? data : [data]
  const out = []
  for (const raw of rows) {
    const r = { ...raw }
    if (!r.id) r.id = crypto.randomUUID()
    const now = new Date().toISOString()
    if (!r.created_at) r.created_at = now
    r.updated_at = now
    const cols = Object.keys(r).filter(k => r[k] !== undefined)
    const vals = cols.map(k => typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : r[k])
    const updateCols = cols.filter(c => c !== onConflict && c !== 'created_at')
    const updateSet = updateCols.map(c => `${c} = excluded.${c}`).join(', ')
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
      ON CONFLICT(${onConflict}) DO UPDATE SET ${updateSet} RETURNING *`
    const res = await DB.prepare(sql).bind(...vals).all()
    out.push(res.results?.[0] ?? r)
  }
  return out
}

// ── Realtime DO notifications after writes ─────────────────────────────────────

function channels(table, row) {
  if (table === 'event_cards'          && row?.event_id) return [`cards:${row.event_id}`]
  if (table === 'message_deliveries'   && row?.event_id) return [`deliveries:${row.event_id}`]
  if (table === 'message_schedules'    && row?.event_id) return [`schedules:${row.event_id}`, 'schedules-all']
  if (table === 'message_schedule_runs'&& row?.event_id) return [`schedules:${row.event_id}`, 'schedules-all']
  return []
}

export function notifyDO(env, table, eventType, rows) {
  if (!env.REALTIME_HUB) return
  const seen = new Map()
  for (const row of (Array.isArray(rows) ? rows : [rows])) {
    for (const ch of channels(table, row)) {
      if (!seen.has(ch)) seen.set(ch, [])
      seen.get(ch).push(row)
    }
  }
  for (const [channel, chRows] of seen) {
    const payload = JSON.stringify({
      channel, table, eventType,
      new: eventType === 'DELETE' ? null : (chRows.length === 1 ? chRows[0] : chRows[0]),
      old: eventType === 'DELETE' ? { id: chRows[0].id } : null,
    })
    try {
      env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName(channel))
        .fetch(new Request('https://x/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }))
        .catch(() => {})
    } catch {}
  }
}

// ── Convenience wrapper used by the Worker handler ─────────────────────────────

export function d1Client(DB, env) {
  const notify = (table, et, rows) => notifyDO(env, table, et, rows)

  const crud = {
    select: (opts)  => d1Select(DB, opts),
    insert: async (opts) => { const r = await d1Insert(DB, opts); notify(opts.table, 'INSERT', r); return r },
    update: async (opts) => { const r = await d1Update(DB, opts); notify(opts.table, 'UPDATE', r); return r },
    delete: async (opts) => { const r = await d1Delete(DB, opts); notify(opts.table, 'DELETE', r); return r },
    upsert: async (opts) => { const r = await d1Upsert(DB, opts); notify(opts.table, 'UPDATE', r); return r },
  }
  return crud
}

// ── Low-level helpers (re-exported for RPCs) ───────────────────────────────────
export { d1Select as select, d1Insert as insert, d1Update as update, d1Delete as del, d1Upsert as upsert }

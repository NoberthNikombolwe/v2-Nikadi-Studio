// Worker implementations of every PostgreSQL stored procedure from supabase-schema.sql.
// Called from the /api/rpc/:fn route in worker.js.
// All functions receive (DB, params, email) where email is the CF Access user email.

import { d1Select, d1Insert, d1Update, d1Delete, notifyDO } from './d1.js'
import { clip } from './db.js'

// ── Permission helpers ─────────────────────────────────────────────────────────

async function getUser(DB, email) {
  const rows = await d1Select(DB, { table: 'app_users', filters: [{ col: 'email', op: 'eq', val: email }] })
  return rows[0] || null
}

async function getUserRole(DB, email) {
  const u = await getUser(DB, email)
  return u?.active ? (u.role || 'viewer') : null
}

async function hasPerm(DB, email, module, edit = false) {
  const role = await getUserRole(DB, email)
  if (!role) return false
  if (role === 'superuser') return true
  const rows = await d1Select(DB, {
    table: 'role_permissions',
    filters: [{ col: 'role', op: 'eq', val: role }, { col: 'module', op: 'eq', val: module }],
  })
  if (!rows.length) return false
  return edit ? rows[0].can_edit === 1 : rows[0].can_view === 1
}

async function canSeeEvent(DB, email, eventId) {
  const role = await getUserRole(DB, email)
  if (!role) return false
  // Superuser / admin / finance see all events
  const seesAll = await d1Select(DB, {
    table: 'app_roles',
    select: 'sees_all_events',
    filters: [{ col: 'key', op: 'eq', val: role }],
  })
  if (seesAll[0]?.sees_all_events) return true
  // Check assignment or created_by
  const ev = await d1Select(DB, { table: 'events', select: 'created_by', filters: [{ col: 'id', op: 'eq', val: eventId }] })
  if (ev[0]?.created_by?.toLowerCase() === email) return true
  const assign = await d1Select(DB, {
    table: 'event_assignments',
    filters: [{ col: 'event_id', op: 'eq', val: eventId }, { col: 'email', op: 'eq', val: email }],
  })
  return assign.length > 0
}

// ── delivery_state: mirrors the SQL function ───────────────────────────────────
function deliveryState(statusId, groupId) {
  if ([50,51,52,77,88,109].includes(statusId)) return 'sent'
  if ([73].includes(statusId))                 return 'delivered'
  if ([108].includes(statusId))                return 'read'
  if ([53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,74,75,76,78,79,80,107,110,111,112,114,120].includes(statusId)) return 'failed'
  if (groupId === 18)              return 'sent'
  if ([19,22].includes(groupId))   return 'failed'
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH / SESSION
// ═══════════════════════════════════════════════════════════════════════════════

export async function server_time(DB, _params, _email) {
  return new Date().toISOString()
}

export async function touch_last_seen(DB, _params, email) {
  if (!email) return false
  await d1Update(DB, { table: 'app_users', data: { last_seen: new Date().toISOString() }, filters: [{ col: 'email', op: 'eq', val: email }] })
  return true
}

export async function is_active_user(DB, _params, email) {
  const u = await getUser(DB, email)
  return !!(u?.active)
}

export async function my_role(DB, _params, email) {
  return await getUserRole(DB, email)
}

export async function has_perm(DB, { p_module, p_edit }, email) {
  return hasPerm(DB, email, p_module, p_edit)
}

export async function can_see_event(DB, { p_event_id }, email) {
  return canSeeEvent(DB, email, p_event_id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS MATRIX (used by useAccess)
// ═══════════════════════════════════════════════════════════════════════════════

export async function get_my_access(DB, _params, email) {
  const u = await getUser(DB, email)
  if (!u?.active) return null
  const perms = await d1Select(DB, { table: 'role_permissions', filters: [{ col: 'role', op: 'eq', val: u.role }] })
  return { user: u, permissions: perms }
}

// ═══════════════════════════════════════════════════════════════════════════════
// USERS / ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function assignable_users(DB, _params, email) {
  if (!(await hasPerm(DB, email, 'events', true))) return []
  return d1Select(DB, { table: 'app_users', select: 'email,role', filters: [{ col: 'active', op: 'eq', val: 1 }], order: [{ col: 'email', asc: true }] })
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD RULES
// ═══════════════════════════════════════════════════════════════════════════════

export async function people_for_card_type(DB, { p_card_type }, _email) {
  const rows = await d1Select(DB, { table: 'card_type_rules', filters: [{ col: 'card_type', op: 'eq', val: p_card_type }], order: [{ col: 'priority', asc: false }] })
  return rows[0]?.people ?? 1
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

export async function scan_card(DB, { p_code, p_count, p_door_name }, _email, env) {
  if (!p_code) return { ok: false, error: 'No code provided' }
  const count = Math.max(1, parseInt(p_count) || 1)

  // Find card by card_code
  const cards = await d1Select(DB, { table: 'event_cards', filters: [{ col: 'card_code', op: 'eq', val: p_code }] })
  if (!cards.length) return { ok: false, error: 'Card not found' }
  const card = cards[0]

  // Check event has valid scan_code (validate event access)
  const events = await d1Select(DB, { table: 'events', select: 'id,scan_code,status', filters: [{ col: 'id', op: 'eq', val: card.event_id }] })
  if (!events.length || events[0].status !== 'active') return { ok: false, error: 'Event not found' }

  const newCount = (card.scan_count || 0) + count
  if (newCount > card.max_scans) return { ok: false, error: `Already scanned (${card.scan_count}/${card.max_scans})` }

  const now = new Date().toISOString()

  // Atomic update: increment scan count
  await DB.batch([
    DB.prepare('UPDATE event_cards SET scan_count = ?, last_scanned_at = ?, updated_at = ? WHERE id = ?')
      .bind(newCount, now, now, card.id),
    DB.prepare('INSERT INTO scan_logs (id,event_id,card_id,scan_count,scanned_by,scanned_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), card.event_id, card.id, count, p_door_name || null, now),
  ])

  // Push realtime update for the card
  notifyDO(env, 'event_cards', 'UPDATE', [{ ...card, scan_count: newCount, last_scanned_at: now }])

  return { ok: true, card: { ...card, scan_count: newCount, last_scanned_at: now }, count }
}

export async function public_scan_event(DB, { p_scan_code }, _email) {
  const events = await d1Select(DB, { table: 'events', select: 'id,username,event_type,start_datetime,end_datetime,venue_name,status', filters: [{ col: 'scan_code', op: 'eq', val: p_scan_code }] })
  return events[0] || null
}

export async function public_find_cards(DB, { p_event_id, p_query }, _email) {
  if (!p_query || p_query.length < 2) return []
  return d1Select(DB, {
    table: 'event_cards',
    select: 'id,card_code,name,card_type,max_scans,scan_count,last_scanned_at',
    filters: [{ col: 'event_id', op: 'eq', val: p_event_id }, { col: 'name', op: 'ilike', val: `%${p_query}%` }],
    order: [{ col: 'name', asc: true }], limit: 20,
  })
}

export async function public_recent_scans(DB, { p_event_id }, _email) {
  return d1Select(DB, {
    table: 'scan_logs',
    select: 'id,card_id,scan_count,scanned_by,scanned_at,detail',
    filters: [{ col: 'event_id', op: 'eq', val: p_event_id }],
    order: [{ col: 'scanned_at', asc: false }], limit: 50,
  })
}

export async function public_scan_stats(DB, { p_event_id }, _email) {
  const total   = (await DB.prepare('SELECT COUNT(*) AS n FROM event_cards WHERE event_id = ? AND in_list = 1').bind(p_event_id).first())?.n ?? 0
  const scanned = (await DB.prepare('SELECT COUNT(*) AS n FROM event_cards WHERE event_id = ? AND scan_count > 0').bind(p_event_id).first())?.n ?? 0
  const checks  = (await DB.prepare('SELECT SUM(scan_count) AS n FROM event_cards WHERE event_id = ?').bind(p_event_id).first())?.n ?? 0
  return { total, scanned, checks }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC VIEW (view-only share link)
// ═══════════════════════════════════════════════════════════════════════════════

function maskPhone(phone) {
  if (!phone) return null
  const s = String(phone)
  return s.length > 4 ? s.slice(0, s.length - 4).replace(/./g, '*') + s.slice(-4) : '****'
}

export async function public_view_event(DB, { p_view_code }, _email) {
  const rows = await d1Select(DB, { table: 'events', select: 'id,username,event_type,start_datetime,end_datetime,venue_name', filters: [{ col: 'view_code', op: 'eq', val: p_view_code }] })
  return rows[0] || null
}

export async function public_view_guests(DB, { p_event_id, p_page }, _email) {
  const offset = Math.max(0, parseInt(p_page || 0)) * 100
  const rows = await d1Select(DB, { table: 'event_cards', select: 'id,name,card_type,wa_status,sms_status,scan_count,call_status', filters: [{ col: 'event_id', op: 'eq', val: p_event_id }, { col: 'in_list', op: 'eq', val: 1 }], order: [{ col: 'name', asc: true }], limit: 100, offset })
  return rows.map(r => ({ ...r, phone: null }))  // phones always masked
}

export async function public_view_history(DB, { p_event_id }, _email) {
  return d1Select(DB, { table: 'event_logs', select: 'id,channel,action,status,recipient_name,message_title,detail,created_at', filters: [{ col: 'event_id', op: 'eq', val: p_event_id }], order: [{ col: 'created_at', asc: false }], limit: 200 })
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE SCHEDULES
// ═══════════════════════════════════════════════════════════════════════════════

export async function save_message_schedule(DB, { p_schedule_id, p_event_id, p_channel, p_config, p_run_times }, email, env) {
  if (!await hasPerm(DB, email, p_channel, true)) throw new Error('Permission denied')
  if (!await canSeeEvent(DB, email, p_event_id)) throw new Error('Event not found')

  const now = new Date().toISOString()
  const serverNow = Date.now()
  const futureTimes = (p_run_times || []).filter(t => new Date(t).getTime() > serverNow - 5000)
  if (!futureTimes.length) throw new Error('No valid future run times')

  let scheduleId = p_schedule_id
  if (scheduleId) {
    // Edit existing: cancel pending runs, replace them
    await d1Update(DB, { table: 'message_schedules', data: { ...p_config, channel: p_channel, updated_at: now }, filters: [{ col: 'id', op: 'eq', val: scheduleId }] })
    await d1Delete(DB, { table: 'message_schedule_runs', filters: [{ col: 'schedule_id', op: 'eq', val: scheduleId }, { col: 'status', op: 'eq', val: 'pending' }] })
  } else {
    scheduleId = crypto.randomUUID()
    const [sched] = await d1Insert(DB, {
      table: 'message_schedules',
      data: { id: scheduleId, event_id: p_event_id, channel: p_channel, ...p_config, created_by: email },
    })
    notifyDO(env, 'message_schedules', 'INSERT', [sched])
  }

  // Insert run rows
  const runs = futureTimes.map(t => ({ id: crypto.randomUUID(), schedule_id: scheduleId, event_id: p_event_id, run_at: t, status: 'pending' }))
  for (const run of runs) {
    await d1Insert(DB, { table: 'message_schedule_runs', data: run })
  }
  notifyDO(env, 'message_schedule_runs', 'INSERT', runs)

  const result = await d1Select(DB, { table: 'message_schedules', filters: [{ col: 'id', op: 'eq', val: scheduleId }] })
  notifyDO(env, 'message_schedules', 'UPDATE', result)
  return result[0]
}

export async function set_message_schedule_status(DB, { p_id, p_status }, email, env) {
  if (!p_id || !['active','paused','cancelled'].includes(p_status)) throw new Error('Invalid params')
  const rows = await d1Select(DB, { table: 'message_schedules', filters: [{ col: 'id', op: 'eq', val: p_id }] })
  if (!rows.length) throw new Error('Schedule not found')
  const sched = rows[0]
  if (!await hasPerm(DB, email, sched.channel, true)) throw new Error('Permission denied')
  if (!await canSeeEvent(DB, email, sched.event_id)) throw new Error('Event not found')
  const updated = await d1Update(DB, { table: 'message_schedules', data: { status: p_status }, filters: [{ col: 'id', op: 'eq', val: p_id }] })
  notifyDO(env, 'message_schedules', 'UPDATE', updated)
  return updated[0]
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER (called by Worker cron / run-schedules handler)
// ═══════════════════════════════════════════════════════════════════════════════

export async function claim_schedule_run(DB, _params, _email) {
  const now = new Date().toISOString()
  const lockUntil = new Date(Date.now() + 35_000).toISOString()
  const workerId = crypto.randomUUID()

  // Find oldest due pending run on an active server schedule
  const due = await DB.prepare(`
    SELECT r.id, r.schedule_id, r.event_id, r.run_at, s.channel, s.message_key, s.message, s.created_by,
           s.sent_by, s.status AS schedule_status
    FROM message_schedule_runs r
    JOIN message_schedules s ON s.id = r.schedule_id
    WHERE r.status = 'pending'
      AND s.status = 'active'
      AND s.sent_by = 'server'
      AND r.run_at <= ?
    ORDER BY r.run_at ASC
    LIMIT 1
  `).bind(now).first()

  if (!due) return null

  // Mark as sending (atomic update)
  const changed = await DB.prepare(
    `UPDATE message_schedule_runs SET status = 'sending', started_at = ?, locked_until = ?, worker_id = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' RETURNING *`
  ).bind(now, lockUntil, workerId, now, due.id).all()

  if (!changed.results?.length) return null  // race — another worker claimed it

  return { ...due, status: 'sending', started_at: now }
}

export async function save_run_progress(DB, { p_run_id, p_next_index, p_sent, p_failed, p_skipped, p_release }, _email, env) {
  const lockUntil = p_release ? null : new Date(Date.now() + 35_000).toISOString()
  const rows = await d1Update(DB, {
    table: 'message_schedule_runs',
    data: { sent: p_sent, failed: p_failed, skipped: p_skipped, locked_until: lockUntil, detail: p_next_index != null ? String(p_next_index) : null },
    filters: [{ col: 'id', op: 'eq', val: p_run_id }],
  })
  notifyDO(env, 'message_schedule_runs', 'UPDATE', rows)
  return true
}

export async function finish_schedule_run(DB, { p_run_id, p_status, p_detail }, _email, env) {
  const rows = await d1Update(DB, {
    table: 'message_schedule_runs',
    data: { status: p_status || 'done', detail: p_detail, finished_at: new Date().toISOString(), locked_until: null },
    filters: [{ col: 'id', op: 'eq', val: p_run_id }],
  })
  notifyDO(env, 'message_schedule_runs', 'UPDATE', rows)
  // Also notify the parent schedule so the UI refreshes
  if (rows.length) notifyDO(env, 'message_schedules', 'UPDATE', [{ id: rows[0].schedule_id, event_id: rows[0].event_id }])
  return rows[0]
}

export async function record_schedule_handover(DB, { p_run_id, p_status, p_detail }, _email, env) {
  return finish_schedule_run(DB, { p_run_id, p_status: p_status || 'handed', p_detail }, _email, env)
}

export async function finish_handed_runs(DB, _params, _email, env) {
  const now = new Date().toISOString()
  const rows = await DB.prepare(
    `UPDATE message_schedule_runs SET status = 'done', finished_at = ?, updated_at = ?
     WHERE status = 'handed' AND run_at <= ? RETURNING *`
  ).bind(now, now, now).all()
  for (const r of rows.results || []) notifyDO(env, 'message_schedule_runs', 'UPDATE', [r])
  return rows.results?.length ?? 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

export async function record_message_sends(DB, { p_items }, email, env) {
  if (!Array.isArray(p_items)) return 0
  let n = 0
  for (const it of p_items) {
    const channel = it.channel
    if (!it.event_id || !['sms','whatsapp'].includes(channel)) continue
    const state = it.status || deliveryState(it.status_id, it.status_group) || 'failed'
    const sentAt = it.sent_at && new Date(it.sent_at) > new Date() ? it.sent_at : new Date().toISOString()
    const row = {
      id: crypto.randomUUID(),
      message_id: it.message_id || null,
      event_id: it.event_id,
      event_card_id: it.event_card_id || null,
      channel,
      message_key: clip(it.message_key || 'custom', 64),
      message_title: clip(it.message_title, 120),
      recipient_name: clip(it.recipient_name, 200),
      phone: clip(it.phone, 20),
      schedule_run_id: it.schedule_run_id || null,
      status: ['sent','delivered','read','failed'].includes(state) ? state : 'failed',
      status_id: it.status_id ?? null,
      status_group: it.status_group ?? null,
      status_name: clip(it.status_name, 80),
      reason: clip(it.reason, 300),
      done_at: ['delivered','read','failed'].includes(state) ? new Date().toISOString() : null,
      source: 'send',
      created_by: it.created_by || email,
      sent_at: sentAt,
    }
    try {
      await d1Insert(DB, { table: 'message_deliveries', data: row })
      notifyDO(env, 'message_deliveries', 'INSERT', [row])
    } catch { /* ON CONFLICT — message_id already exists */ }

    // Update card status if needed
    if (it.update_card !== false && it.event_card_id) {
      if (channel === 'sms' && it.message_key === 'main') {
        await d1Update(DB, { table: 'event_cards', data: { sms_status: state === 'read' ? 'delivered' : state, sent_at: new Date().toISOString() }, filters: [{ col: 'id', op: 'eq', val: it.event_card_id }] })
      } else if (channel === 'whatsapp' && it.message_key === 'card') {
        const wa = it.card_status || (state === 'failed' ? 'notSent' : state)
        await d1Update(DB, { table: 'event_cards', data: { wa_status: wa, sent_at: new Date().toISOString() }, filters: [{ col: 'id', op: 'eq', val: it.event_card_id }] })
      }
    }
    n++
  }
  return n
}

export async function set_card_send_statuses(DB, { p_items }, _email, env) {
  if (!Array.isArray(p_items)) return 0
  let n = 0
  for (const it of p_items) {
    if (!it.id) continue
    const data = {}
    if (it.sms != null) data.sms_status = it.sms
    if (it.wa  != null) data.wa_status  = it.wa
    if (!Object.keys(data).length) continue
    const rows = await d1Update(DB, { table: 'event_cards', data, filters: [{ col: 'id', op: 'eq', val: it.id }] })
    if (rows.length) notifyDO(env, 'event_cards', 'UPDATE', rows)
    n++
  }
  return n
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function claim_pending_deliveries(DB, { p_limit }, _email) {
  const limit = Math.min(parseInt(p_limit) || 200, 500)
  const now   = new Date()
  const cut1h = new Date(now - 60 * 60 * 1000).toISOString()
  const cut1d = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const cut3d = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
  const checkedAt = new Date(now - 4 * 60 * 1000).toISOString()

  // Rows still 'sent', up to 3 days old, respecting check frequency
  const rows = await DB.prepare(`
    SELECT message_id, channel FROM message_deliveries
    WHERE status = 'sent'
      AND sent_at >= ?
      AND (checked_at IS NULL OR checked_at < ?)
    ORDER BY sent_at ASC LIMIT ?
  `).bind(cut3d, checkedAt, limit).all()

  if (!rows.results?.length) return []

  const ids = rows.results.map(r => r.message_id).filter(Boolean)
  if (ids.length) {
    const stamp = now.toISOString()
    // Stamp checked_at in a batch
    for (const id of ids) {
      await DB.prepare('UPDATE message_deliveries SET checked_at = ?, checks = checks + 1 WHERE message_id = ?').bind(stamp, id).run()
    }
  }

  return rows.results
}

export async function apply_delivery_results(DB, { p_items, p_source }, _email, env) {
  if (!Array.isArray(p_items)) return { updated: 0, delivered: 0, read: 0, failed: 0, unknown: 0 }
  const src = ['callback','check'].includes(p_source) ? p_source : 'check'
  let updated = 0, delivered = 0, read = 0, failed = 0, unknown = 0

  for (const it of p_items) {
    const msgId = it.message_id
    if (!msgId) { unknown++; continue }

    const d = await DB.prepare('SELECT * FROM message_deliveries WHERE message_id = ?').bind(msgId).first()
    if (!d) { unknown++; continue }

    const state = deliveryState(it.status_id, it.group_id)
    // Only forward transitions
    if (!state || !(  (d.status === 'sent' && state !== 'sent') || (d.status === 'delivered' && state === 'read') )) continue

    const now = new Date().toISOString()
    await DB.prepare(`UPDATE message_deliveries SET status=?,status_id=?,status_group=?,status_name=?,reason=?,done_at=?,updated_at=?,source=?
      WHERE message_id=?`
    ).bind(state, it.status_id, it.group_id ?? d.status_group, clip(it.status_name || d.status_name, 80),
      state === 'failed' ? clip(it.reason || it.status_name, 300) : null,
      it.done_at || now, now, src, msgId
    ).run()

    // Update card status (latest send, not before reset)
    if (d.event_card_id && (
      (d.channel === 'sms' && d.message_key === 'main') ||
      (d.channel === 'whatsapp' && d.message_key === 'card')
    )) {
      const isLatest = !(await DB.prepare(
        `SELECT 1 FROM message_deliveries WHERE event_card_id=? AND channel=? AND message_key=? AND sent_at>? AND sent_at<=? LIMIT 1`
      ).bind(d.event_card_id, d.channel, d.message_key, d.sent_at, now).first())
      const notReset = !(await DB.prepare(
        `SELECT 1 FROM event_cards WHERE id=? AND status_reset_at IS NOT NULL AND ? <= status_reset_at LIMIT 1`
      ).bind(d.event_card_id, d.sent_at).first())
      if (isLatest && notReset) {
        if (d.channel === 'sms') {
          await d1Update(DB, { table: 'event_cards', data: { sms_status: state === 'read' ? 'delivered' : state }, filters: [{ col: 'id', op: 'eq', val: d.event_card_id }] })
        } else {
          const wa = state === 'failed' ? ([76,111,120].includes(it.status_id) ? 'invalid' : 'notSent') : state
          await d1Update(DB, { table: 'event_cards', data: { wa_status: wa }, filters: [{ col: 'id', op: 'eq', val: d.event_card_id }] })
        }
        notifyDO(env, 'event_cards', 'UPDATE', [{ id: d.event_card_id, event_id: d.event_id }])
      }
    }

    // History row
    await d1Insert(DB, { table: 'event_logs', data: { id: crypto.randomUUID(), event_id: d.event_id, channel: d.channel, action: 'status', status: state === 'read' ? 'delivered' : state, recipient_name: d.recipient_name, recipient_phone: d.phone, message_title: d.message_title, detail: clip(`Delivery report: ${it.status_name || state} (${src === 'callback' ? 'webhook' : 'checked'})`, 500), user_email: 'delivery report' } })

    // Notify deliveries channel
    notifyDO(env, 'message_deliveries', 'UPDATE', [{ ...d, status: state, event_id: d.event_id }])

    updated++
    if (state === 'delivered') delivered++
    else if (state === 'read') read++
    else if (state === 'failed') failed++
  }

  return { updated, delivered, read, failed, unknown }
}

export async function record_delivery_reply(DB, { p_message_id, p_text }, _email, env) {
  const now = new Date().toISOString()
  const d = await DB.prepare('SELECT * FROM message_deliveries WHERE message_id = ?').bind(p_message_id).first()
  if (!d) return false

  await DB.prepare('UPDATE message_deliveries SET reply_text=?,replied_at=?,updated_at=? WHERE message_id=?')
    .bind(clip(p_text, 500), now, now, p_message_id).run()

  await d1Insert(DB, { table: 'event_logs', data: { id: crypto.randomUUID(), event_id: d.event_id, channel: d.channel, action: 'reply', status: 'ok', recipient_name: d.recipient_name, recipient_phone: d.phone, message_title: d.message_title, detail: clip(`Replied: ${p_text || ''}`, 500), user_email: 'guest reply' } })

  // Map reply to call outcome via wa_template quick_reply_fields
  if (d.event_card_id) {
    const ev = await DB.prepare(`SELECT e.wa_template FROM events e WHERE e.id = ?`).bind(d.event_id).first()
    const tmpl = ev?.wa_template
      ? await DB.prepare('SELECT quick_reply_fields FROM wa_templates WHERE name = ?').bind(ev.wa_template).first()
      : await DB.prepare('SELECT quick_reply_fields FROM wa_templates WHERE is_default = 1 LIMIT 1').first()
    if (tmpl?.quick_reply_fields) {
      try {
        const fields = JSON.parse(tmpl.quick_reply_fields)
        const match  = fields.find(f => f.call_outcome && f.button_text?.toLowerCase().trim() === p_text?.toLowerCase().trim())
        if (match) {
          await DB.prepare(`UPDATE event_cards SET call_status=?,call_by='wa_reply',call_updated_at=? WHERE id=? AND (call_status IS NULL OR call_by='wa_reply')`)
            .bind(match.call_outcome, now, d.event_card_id).run()
        }
      } catch {}
    }
  }

  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUEST CARD DELETE (Super Admin only)
// ═══════════════════════════════════════════════════════════════════════════════

export async function delete_guest_card(DB, { p_id }, email, env) {
  const role = await getUserRole(DB, email)
  if (role !== 'superuser') throw new Error('Super Admin only')
  const cards = await d1Select(DB, { table: 'event_cards', filters: [{ col: 'id', op: 'eq', val: p_id }] })
  if (!cards.length) throw new Error('Card not found')
  const card = cards[0]
  if (!await canSeeEvent(DB, email, card.event_id)) throw new Error('Not authorized')

  await d1Insert(DB, { table: 'event_logs', data: { id: crypto.randomUUID(), event_id: card.event_id, channel: 'event', action: 'guest_delete', status: 'ok', recipient_name: card.name, recipient_phone: card.phone, detail: 'Guest card deleted', user_email: email } })
  await d1Delete(DB, { table: 'event_cards', filters: [{ col: 'id', op: 'eq', val: p_id }] })
  notifyDO(env, 'event_cards', 'DELETE', [card])
  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════════

export async function submit_feedback(DB, { kind, rating, message, page, event_id, device }, email) {
  if (!email) throw new Error('Not signed in')
  const rows = await d1Insert(DB, { table: 'app_feedback', data: { id: crypto.randomUUID(), kind: kind || 'idea', rating: rating || null, message: clip(message, 4000), page: page || null, event_id: event_id || null, device: clip(device, 200), status: 'new', created_by: email } })
  return rows[0]
}

// ═══════════════════════════════════════════════════════════════════════════════
// SET VIEW / SCAN CODE
// ═══════════════════════════════════════════════════════════════════════════════

export async function set_view_code(DB, { p_event_id }, email) {
  if (!await canSeeEvent(DB, email, p_event_id)) throw new Error('Not authorized')
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
  await d1Update(DB, { table: 'events', data: { view_code: code }, filters: [{ col: 'id', op: 'eq', val: p_event_id }] })
  return code
}

export async function set_scan_code(DB, { p_event_id }, email) {
  if (!await canSeeEvent(DB, email, p_event_id)) throw new Error('Not authorized')
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  await d1Update(DB, { table: 'events', data: { scan_code: code }, filters: [{ col: 'id', op: 'eq', val: p_event_id }] })
  return code
}

// ═══════════════════════════════════════════════════════════════════════════════
// RPC DISPATCH TABLE
// ═══════════════════════════════════════════════════════════════════════════════

export const RPC = {
  server_time, touch_last_seen, is_active_user, my_role, has_perm, can_see_event,
  get_my_access, assignable_users, people_for_card_type,
  scan_card, public_scan_event, public_find_cards, public_recent_scans, public_scan_stats,
  public_view_event, public_view_guests, public_view_history,
  save_message_schedule, set_message_schedule_status,
  claim_schedule_run, save_run_progress, finish_schedule_run,
  record_schedule_handover, finish_handed_runs,
  record_message_sends, set_card_send_statuses,
  claim_pending_deliveries, apply_delivery_results, record_delivery_reply,
  delete_guest_card, submit_feedback, set_view_code, set_scan_code,
}

// Delivery sync — ported from supabase/functions/_shared/deliveries.ts.
// Called by the run-schedules handler when task==="deliveries".
// Checks delivery reports for messages still waiting (up to 3 days).

import { UPSTREAM, cleanToken } from './proxy.js'
import { parseDeliveryReports, reportsQueries, statusReason } from '../studio/supabase/functions/_shared/messaging.js'

const UPSTREAM_TIMEOUT_MS = 20_000
const CLAIM_LIMIT = 200

const tokenFor = (channel, env) => channel === 'sms'
  ? cleanToken(env.SMS_BEARER_TOKEN)
  : cleanToken(env.WA_BEARER_TOKEN) || cleanToken(env.SMS_BEARER_TOKEN)

export const syncDeliveries = async (db, env, { outOfTime = () => false, limit = CLAIM_LIMIT } = {}) => {
  const totals = { checked: 0, updated: 0, delivered: 0, read: 0, failed: 0, unknown: 0, errors: 0 }
  const due = await db.rpc('claim_pending_deliveries', { p_limit: limit })
  if (!Array.isArray(due) || !due.length) return totals
  totals.checked = due.length

  const ids = { sms: [], whatsapp: [] }
  due.forEach(r => { if (ids[r.channel] && r.message_id) ids[r.channel].push(String(r.message_id)) })

  for (const channel of ['sms', 'whatsapp']) {
    if (!ids[channel].length) continue
    const token = tokenFor(channel, env)
    if (!token) { totals.errors++; continue }
    for (const query of reportsQueries(ids[channel], channel)) {
      if (outOfTime()) return totals
      try {
        const res = await fetch(`${UPSTREAM}/api/v2/reports${query}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
        const text = await res.text()
        if (!res.ok) { totals.errors++; continue }
        const items = parseDeliveryReports(text).map(r => ({
          ...r, reason: statusReason(r.status_id, r.status_name) || null,
        }))
        if (!items.length) continue
        const out = await db.rpc('apply_delivery_results', { p_items: items, p_source: 'check' })
        for (const k of ['updated', 'delivered', 'read', 'failed', 'unknown']) {
          totals[k] += Number(out?.[k]) || 0
        }
      } catch {
        totals.errors++
      }
    }
  }
  return totals
}

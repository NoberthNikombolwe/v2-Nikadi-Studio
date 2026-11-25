// Delivery webhook — ported from supabase/functions/_shared/webhook.ts.
// NextSMS posts every delivery result here.
//
// Set the Delivery Callback URL in NextSMS dashboard once to:
//   https://v2-nikadi-studio.noberthbariki.workers.dev/api/delivery-webhook
// Verify Token = NEXTSMS_CALLBACK_TOKEN (Worker secret)

import { cleanToken } from './proxy.js'
import { parseProviderJson, parseDeliveryCallback, statusReason } from '../studio/supabase/functions/_shared/messaging.js'
import { json, sameSecret, serviceClient } from './db.js'
import { apply_delivery_results, record_delivery_reply } from './d1-rpc.js'

const MAX_BODY = 10_000

export const handleDeliveryWebhook = async (request, env) => {
  if (request.method === 'GET') return json(200, { ok: true })  // reachability check
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'Request too large' })

  let body = null
  try { body = raw ? parseProviderJson(raw) : null } catch { body = null }

  const msg = parseDeliveryCallback(body)
  if (msg.kind === 'ping') return json(200, { ok: true })

  const secret = cleanToken(env.NEXTSMS_CALLBACK_TOKEN)
  if (!secret) return json(500, { error: 'Server is not configured' })
  if (!sameSecret(cleanToken(String(body?.token ?? '')), secret)) return json(401, { error: 'Not allowed' })

  if (!env.DB && !serviceClient(env)) return json(500, { error: 'Server is not configured' })

  try {
    if (msg.kind === 'reply') {
      if (env.DB) {
        const saved = await record_delivery_reply(env.DB, { p_message_id: msg.message_id, p_text: msg.text }, null, env)
        return json(200, { ok: true, saved: saved === true })
      }
      const db = serviceClient(env)
      const saved = await db.rpc('record_delivery_reply', { p_message_id: msg.message_id, p_text: msg.text })
      return json(200, { ok: true, saved: saved === true })
    }

    const item = { message_id: msg.message_id, status_id: msg.status_id, status_name: msg.status_name,
      reason: statusReason(msg.status_id, msg.status_name) || null }

    if (env.DB) {
      const out = await apply_delivery_results(env.DB, { p_items: [item], p_source: 'callback' }, null, env)
      return json(200, { ok: true, updated: Number(out?.updated) || 0, unknown: Number(out?.unknown) || 0 })
    }

    const db = serviceClient(env)
    const out = await db.rpc('apply_delivery_results', { p_items: [item], p_source: 'callback' })
    return json(200, { ok: true, updated: Number(out?.updated) || 0, unknown: Number(out?.unknown) || 0 })
  } catch {
    return json(500, { error: 'Could not save the result' })
  }
}

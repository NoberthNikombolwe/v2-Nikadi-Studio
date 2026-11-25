// Scheduled-send runner — ported from supabase/functions/_shared/scheduler.ts.
// Deno.env removed; pass env to createScheduler().
// BUDGET_MS reduced from 35 s to 25 s to stay within the Worker 30 s wall-clock limit.

import { UPSTREAM, cleanToken } from './proxy.js'
import { scheduleTargets, describeTargetSkips, sendSmsMessages, smsSendResult, classifyWaSend, waCardStatus } from '../studio/supabase/functions/_shared/messaging.js'
import { json, sameSecret, restClient, clip } from './db.js'
import { syncDeliveries } from './deliveries.js'
import { d1Select, d1Insert, notifyDO } from './d1.js'
import { claim_schedule_run, save_run_progress, finish_schedule_run, record_message_sends } from './d1-rpc.js'

export { sameSecret }

const BUDGET_MS = 25_000
const UPSTREAM_TIMEOUT_MS = 20_000
const SMS_BATCH = 100
const WA_GAP_MS = 1_000

// Build a database adapter — uses D1 when env.DB is set, otherwise Supabase PostgREST.
const database = (env) => {
  if (env.DB) {
    // D1 path — all data in Cloudflare
    const DB = env.DB
    return {
      rest: null,
      claim: () => claim_schedule_run(DB, {}, null),
      cards: async (eventId) => {
        const rows = await d1Select(DB, { table: 'event_cards', filters: [{ col: 'event_id', op: 'eq', val: eventId }], order: [{ col: 'created_at', asc: true }] })
        return rows.filter(c => c.in_list !== 0 && c.in_list !== false)
      },
      saveTargets: async (runId, targets) => {
        await DB.prepare('INSERT INTO message_run_targets (id,run_id,targets) VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET targets=excluded.targets')
          .bind(crypto.randomUUID(), runId, JSON.stringify(targets)).run()
      },
      targets: async (runId) => {
        const row = await DB.prepare('SELECT targets FROM message_run_targets WHERE run_id = ?').bind(runId).first()
        try { return row ? JSON.parse(row.targets) : { list: [], note: '' } } catch { return { list: [], note: '' } }
      },
      progress: (runId, next, sent, failed, skipped, release = false) =>
        save_run_progress(DB, { p_run_id: runId, p_next_index: next, p_sent: sent, p_failed: failed, p_skipped: skipped, p_release: release }, null, env)
          .then(() => true).catch(() => false),
      finish: (runId, status, detail) =>
        finish_schedule_run(DB, { p_run_id: runId, p_status: status, p_detail: detail }, null, env),
      recordSends: async (items) => {
        if (!items.length) return
        await record_message_sends(DB, { p_items: items }, null, env)
      },
      logs: async (rows) => {
        if (!rows.length) return
        for (const row of rows) {
          await d1Insert(DB, { table: 'event_logs', data: { id: crypto.randomUUID(), ...row } }).catch(() => null)
        }
      },
    }
  }

  // Supabase PostgREST fallback (used when D1 is not yet set up)
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  const { call, rpc } = restClient(url, key)
  return {
    rest: { call, rpc },
    claim: async () => {
      const rows = await rpc('claim_schedule_run', {})
      return Array.isArray(rows) && rows[0] ? rows[0] : null
    },
    cards: async (eventId) => {
      const rows = await call(`event_cards?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=created_at`)
      return Array.isArray(rows) ? rows.filter(c => c.in_list !== false) : rows
    },
    saveTargets: (runId, targets) =>
      call('message_run_targets?on_conflict=run_id', { method: 'POST', body: JSON.stringify({ run_id: runId, targets }) }, 'resolution=merge-duplicates,return=minimal'),
    targets: async (runId) => {
      const rows = await call(`message_run_targets?run_id=eq.${encodeURIComponent(runId)}&select=targets`)
      return rows?.[0]?.targets || { list: [], note: '' }
    },
    progress: (runId, next, sent, failed, skipped, release = false) =>
      rpc('save_run_progress', { p_run_id: runId, p_next_index: next, p_sent: sent, p_failed: failed, p_skipped: skipped, p_release: release })
        .then(ok => ok === true),
    finish: (runId, status, detail) =>
      rpc('finish_schedule_run', { p_run_id: runId, p_status: status, p_detail: detail }),
    recordSends: async (items) => {
      if (!items.length) return
      try {
        await rpc('record_message_sends', { p_items: items })
      } catch (e) {
        if (!/Database error 404|Could not find the function/i.test(e.message)) return
        const cards = items
          .filter(it => it.update_card !== false && it.event_card_id
            && ((it.channel === 'sms' && it.message_key === 'main') || (it.channel === 'whatsapp' && it.message_key === 'card')))
          .map(it => it.channel === 'sms'
            ? { id: it.event_card_id, sms_status: it.status === 'read' ? 'delivered' : it.status }
            : { id: it.event_card_id, wa_status: it.card_status || 'notSent' })
        if (cards.length) await rpc('set_card_send_statuses', { p_items: cards }).catch(() => null)
      }
    },
    logs: async (rows) => {
      if (!rows.length) return
      await call('event_logs', { method: 'POST', body: JSON.stringify(rows) }, 'return=minimal').catch(() => null)
    },
  }
}

// Core scheduler — same logic whether invoked via HTTP or cron.
export const runScheduler = async (env, body, { budgetMs = BUDGET_MS, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) => {
  if (!env.DB && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY))
    return json(500, { error: 'Server is not configured' })

  const db = database(env)
  const started = now()
  const outOfTime = () => now() - started >= budgetMs
  const task = body?.task

  if (task === 'deliveries') {
    try {
      return json(200, { ok: true, deliveries: await syncDeliveries(env.DB ? null : db.rest, env, { outOfTime }) })
    } catch (e) {
      return json(500, { error: e.message })
    }
  }

  const runs = []
  try {
    while (!outOfTime()) {
      const run = await db.claim()
      if (!run) break
      runs.push(await sendRun(db, run, env, { outOfTime, sleep }))
    }
  } catch (e) {
    return json(500, { error: e.message, runs })
  }
  return json(200, { ok: true, runs })
}

// HTTP handler — checks CRON_SECRET before running.
export const createScheduler = () => async (request, env) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const secret = cleanToken(env.CRON_SECRET)
  if (!secret) return json(500, { error: 'Server is not configured' })
  if (!sameSecret(cleanToken(request.headers.get('x-cron-secret')), secret))
    return json(401, { error: 'Not allowed' })
  const body = await request.json().catch(() => null)
  return runScheduler(env, body)
}

const sendRun = async (db, run, env, { outOfTime, sleep }) => {
  const id = run.run_id
  const isSms = run.channel === 'sms'
  const word = isSms ? 'SMS' : 'WhatsApp'
  let sent = Number(run.sent) || 0, failed = Number(run.failed) || 0, skipped = Number(run.skipped) || 0
  let next = Number(run.next_index) || 0
  const summary = state => ({ run_id: id, state, sent, failed, skipped })

  const token = isSms
    ? cleanToken(env.SMS_BEARER_TOKEN)
    : cleanToken(env.WA_BEARER_TOKEN) || cleanToken(env.SMS_BEARER_TOKEN)
  if (!token) {
    await db.finish(id, 'failed', `Not sent: the ${word} provider token is not set on the server (SMS_BEARER_TOKEN)`)
    return summary('failed')
  }

  let list, note
  if (!run.has_targets) {
    const picked = scheduleTargets(await db.cards(run.event_id), {
      channel: run.channel, audience: run.audience, image: !!run.wa_image, body: run.body || '',
    })
    list = picked.targets
    note = describeTargetSkips(picked.skipped)
    skipped = Object.values(picked.skipped).reduce((s, n) => s + n, 0)
    await db.saveTargets(id, { list, note })
    if (!(await db.progress(id, 0, 0, 0, skipped))) return summary('stopped')
    next = 0; sent = 0; failed = 0
  } else {
    const saved = await db.targets(id)
    list = Array.isArray(saved.list) ? saved.list : []
    note = String(saved.note || '')
  }

  const updatesStatus = isSms ? run.message_key === 'main' : !!run.wa_image
  const runLabel = `Scheduled send ${run.run_number} of ${run.total_runs}`
  const logRow = (t, action, status, detail) => ({
    event_id: run.event_id, channel: isSms ? 'sms' : 'whatsapp', action, status,
    recipient_name: clip(t?.name, 200), recipient_phone: t?.phone || null,
    message_title: clip(run.title, 120), detail: clip(detail, 500), user_email: run.created_by || null,
  })
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
  const reasons = new Map()
  const failedFor = reason => reasons.set(reason, (reasons.get(reason) || 0) + 1)

  while (next < list.length) {
    if (outOfTime()) {
      await db.progress(id, next, sent, failed, skipped, true)
      return summary('continues')
    }
    const logs = [], sends = []
    const sendRow = (t, extra) => ({
      event_id: run.event_id, event_card_id: t.id || null, channel: isSms ? 'sms' : 'whatsapp',
      message_key: isSms ? (run.message_key || 'custom') : (run.wa_image ? 'card' : 'text'),
      message_title: clip(run.title, 120), recipient_name: clip(t.name, 200), phone: t.phone,
      schedule_run_id: id, created_by: run.created_by || null, ...extra,
    })

    let batch
    if (isSms) {
      batch = list.slice(next, next + SMS_BATCH)
      const post = async (path, body) => {
        const res = await fetch(`${UPSTREAM}/api/sms/v2${path}`, {
          method: 'POST', headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), body: JSON.stringify(body),
        })
        return { status: res.status, text: await res.text().catch(() => '') }
      }
      const out = await sendSmsMessages(post,
        batch.map(t => ({ from: run.sender_id || env.SMS_SENDER_ID || 'NIKADI', to: t.phone, text: t.text })))
      batch.forEach((t, n) => {
        const problem = n >= out.problemFrom ? out.problem : ''
        const r = smsSendResult(problem ? undefined : out.answers[n])
        const why = problem || (r.missing ? 'no result from the SMS provider' : r.reason)
        if (r.status === 'failed') { failed++; failedFor(why || 'not accepted by the SMS provider') } else sent++
        logs.push(logRow(t, 'send', r.status, why ? `${runLabel} — ${why}` : runLabel))
        sends.push(sendRow(t, { message_id: r.messageId, status: r.status, status_id: r.statusId, status_group: r.groupId,
          status_name: r.statusName, reason: why || null, update_card: updatesStatus && !problem && !r.missing }))
      })
    } else {
      batch = [list[next]]
      const t = batch[0]
      let result
      try {
        const res = await fetch(`${UPSTREAM}/api/whatsapp/v2/text/single`, {
          method: 'POST', headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          body: JSON.stringify({
            to: [Number(t.phone)],
            account: run.wa_account || 'Nikadi',
            template: run.wa_template,
            ...(run.wa_image ? { header: { image: { file: t.cardUrl, name: t.name || 'Event Card' } } } : {}),
          }),
        })
        result = classifyWaSend(res.status, await res.text().catch(() => ''))
      } catch (e) {
        result = { status: 'not_sent', detail: e.message }
      }
      const ok = result.status === 'sent' || result.status === 'delivered' || result.status === 'read'
      if (ok) sent++; else { failed++; failedFor(result.detail || 'not accepted by the WhatsApp provider') }
      logs.push(logRow(t, 'send', result.status, result.detail ? `${runLabel} — ${result.detail}` : runLabel))
      const state = ok ? result.status : 'failed'
      sends.push(sendRow(t, { message_id: result.messageId || null, status: state, status_id: result.statusId ?? null,
        status_group: result.groupId ?? null, status_name: result.statusName || null, reason: ok ? null : (result.detail || null),
        card_status: ok ? waCardStatus(state, result.statusId) : (result.status === 'invalid' ? 'invalid' : 'notSent'),
        update_card: updatesStatus }))
    }

    next += batch.length
    await db.logs(logs)
    await db.recordSends(sends)
    if (!(await db.progress(id, next, sent, failed, skipped))) return summary('stopped')
    if (!isSms && next < list.length) await sleep(WA_GAP_MS)
  }

  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const failedText = failed ? `${failed} failed${top ? ` (${clip(top, 160)}${reasons.size > 1 ? ', and other reasons' : ''})` : ''}` : ''
  const detail = [list.length ? `${sent}/${list.length} ${word} sent` : 'Nobody to send to', failedText, note].filter(Boolean).join(' · ')
  const status = list.length && !sent ? 'failed' : 'done'
  await db.logs([logRow(null, 'bulk', status === 'failed' ? 'failed' : 'ok', `${runLabel}: ${detail}`)])
  await db.finish(id, status, detail)
  return summary(status)
}

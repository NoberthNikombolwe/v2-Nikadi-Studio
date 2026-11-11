// The run-schedules Edge Function: sends the scheduled SMS / WhatsApp messages that are due.
//
// pg_cron calls it every minute while a send is due (supabase-roles-settings-scan.sql §9),
// with the shared secret in the x-cron-secret header. It is not for browsers: no CORS, no
// user session — it works with the service role, so it checks the secret first.
//
// Each call works for about BUDGET_MS, then stops; the next minute carries on:
//   1. claim_schedule_run() leases one due run (two calls never send the same run)
//   2. the first time, the recipients are fixed (scheduleTargets, the same rules the app
//      shows in its preview) and stored in message_run_targets
//   3. SMS go out 100 per request (/text/multi); WhatsApp one by one with a 1 s pause
//   4. after every batch: history rows (event_logs), each send with the provider's messageId
//      (record_message_sends — it also sets the guest's status for main-SMS / card sends, and
//      the delivery reports later move it to delivered / read / failed), and
//      save_run_progress(), which also says stop when the run was cancelled or paused
//   5. finish_schedule_run() closes the run and updates the schedule's counts
// The body {"task":"deliveries"} (a second pg_cron job) instead checks the delivery reports of
// messages still waiting — see deliveries.ts.
// Responses carry counts only — never phone numbers or message text.
//
// Deploy: npx supabase functions deploy run-schedules --no-verify-jwt
// Secrets: CRON_SECRET (same value as the Vault secret nikadi_cron_secret), SMS_BEARER_TOKEN,
// optional WA_BEARER_TOKEN / SMS_SENDER_ID. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by the platform.

import { UPSTREAM, cleanToken } from "./proxy.ts";
import { scheduleTargets, describeTargetSkips, sendSmsMessages, smsSendResult, classifyWaSend, waCardStatus } from "./messaging.js";
import { json, sameSecret, clip, restClient, type Row } from "./db.ts";
import { syncDeliveries } from "./deliveries.ts";

export { sameSecret };

const BUDGET_MS = 35_000;            // + one request's timeout stays under pg_net's 60 s
const UPSTREAM_TIMEOUT_MS = 20_000;
const SMS_BATCH = 100;
const WA_GAP_MS = 1_000;             // same pacing as Send All in the app

export type SchedulerOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
};

// The schedule tables, through PostgREST with the service role key
const database = (url: string, key: string) => {
  const { call, rpc } = restClient(url, key);
  return {
    rest: { call, rpc },
    claim: async (): Promise<Row | null> => {
      const rows = await rpc("claim_schedule_run", {});
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },
    // Guests left off a newer spreadsheet (in_list false, kept only for their call / check-in
    // history) get no scheduled sends. select=* so this still works before that column exists.
    cards: async (eventId: string): Promise<Row[]> => {
      const rows = await call(`event_cards?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=created_at`);
      return Array.isArray(rows) ? rows.filter((c: Row) => c.in_list !== false) : rows;
    },
    saveTargets: (runId: string, targets: Row) =>
      call("message_run_targets?on_conflict=run_id", { method: "POST", body: JSON.stringify({ run_id: runId, targets }) }, "resolution=merge-duplicates,return=minimal"),
    targets: async (runId: string): Promise<Row> => {
      const rows = await call(`message_run_targets?run_id=eq.${encodeURIComponent(runId)}&select=targets`);
      return rows?.[0]?.targets || { list: [], note: "" };
    },
    progress: (runId: string, next: number, sent: number, failed: number, skipped: number, release = false): Promise<boolean> =>
      rpc("save_run_progress", { p_run_id: runId, p_next_index: next, p_sent: sent, p_failed: failed, p_skipped: skipped, p_release: release })
        .then((ok) => ok === true),
    finish: (runId: string, status: "done" | "failed", detail: string) =>
      rpc("finish_schedule_run", { p_run_id: runId, p_status: status, p_detail: detail }),
    // Writes made AFTER the messages went out never throw: if they did, the batch would not be
    // marked as sent, and the next minute would send the same messages again.
    // recordSends: each send with its messageId; before the delivery SQL (§11) exists it falls
    // back to setting the guests' statuses directly, as before.
    recordSends: async (items: Row[]) => {
      if (!items.length) return;
      try {
        await rpc("record_message_sends", { p_items: items });
      } catch (e) {
        if (!/Database error 404|Could not find the function/i.test((e as Error).message)) return;
        const cards = items.filter((it) => it.update_card !== false && it.event_card_id
            && ((it.channel === "sms" && it.message_key === "main") || (it.channel === "whatsapp" && it.message_key === "card")))
          .map((it) => it.channel === "sms" ? { id: it.event_card_id, sms_status: it.status === "read" ? "delivered" : it.status }
            : { id: it.event_card_id, wa_status: it.card_status || "notSent" });
        if (cards.length) await rpc("set_card_send_statuses", { p_items: cards }).catch(() => null);
      }
    },
    logs: async (rows: Row[]) => {
      if (!rows.length) return;
      await call("event_logs", { method: "POST", body: JSON.stringify(rows) }, "return=minimal").catch(() => null);
    },
  };
};
type Db = ReturnType<typeof database>;


export const createScheduler = (opts: SchedulerOptions = {}) => async (req: Request): Promise<Response> => {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.budgetMs ?? BUDGET_MS;

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const secret = cleanToken(Deno.env.get("CRON_SECRET"));
  if (!secret) return json(500, { error: "Server is not configured" });
  if (!sameSecret(cleanToken(req.headers.get("x-cron-secret")), secret)) return json(401, { error: "Not allowed" });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(500, { error: "Server is not configured" });

  const db = database(url, key);
  const started = now();
  const outOfTime = () => now() - started >= budget;
  const task = await req.json().then((b) => b?.task).catch(() => null);
  if (task === "deliveries") {
    try {
      return json(200, { ok: true, deliveries: await syncDeliveries(db.rest, { outOfTime }) });
    } catch (e) {
      return json(500, { error: (e as Error).message });
    }
  }
  const runs: Row[] = [];
  try {
    while (!outOfTime()) {
      const run = await db.claim();
      if (!run) break;
      runs.push(await sendRun(db, run, { outOfTime, sleep }));
    }
  } catch (e) {
    return json(500, { error: (e as Error).message, runs });
  }
  return json(200, { ok: true, runs });
};

// Sends (part of) one claimed run. Returns a summary with counts only.
const sendRun = async (db: Db, run: Row, { outOfTime, sleep }: { outOfTime: () => boolean; sleep: (ms: number) => Promise<void> }): Promise<Row> => {
  const id: string = run.run_id;
  const isSms = run.channel === "sms";
  const word = isSms ? "SMS" : "WhatsApp";
  const summary = (state: string) => ({ run_id: id, state, sent, failed, skipped });
  let sent = Number(run.sent) || 0, failed = Number(run.failed) || 0, skipped = Number(run.skipped) || 0;
  let next = Number(run.next_index) || 0;

  const token = isSms
    ? cleanToken(Deno.env.get("SMS_BEARER_TOKEN"))
    : cleanToken(Deno.env.get("WA_BEARER_TOKEN")) || cleanToken(Deno.env.get("SMS_BEARER_TOKEN"));
  if (!token) {
    await db.finish(id, "failed", `Not sent: the ${word} provider token is not set on the server (SMS_BEARER_TOKEN)`);
    return summary("failed");
  }

  // Who this run goes to — fixed the first time, so a run that takes a few minutes doesn't
  // change its list halfway
  let list: Row[], note: string;
  if (!run.has_targets) {
    const picked = scheduleTargets(await db.cards(run.event_id), {
      channel: run.channel, audience: run.audience, image: !!run.wa_image, body: run.body || "",
    });
    list = picked.targets;
    note = describeTargetSkips(picked.skipped);
    skipped = Object.values(picked.skipped as Record<string, number>).reduce((s, n) => s + n, 0);
    await db.saveTargets(id, { list, note });
    if (!(await db.progress(id, 0, 0, 0, skipped))) return summary("stopped");
    next = 0; sent = 0; failed = 0;
  } else {
    const saved = await db.targets(id);
    list = Array.isArray(saved.list) ? saved.list : [];
    note = String(saved.note || "");
  }

  const updatesStatus = isSms ? run.message_key === "main" : !!run.wa_image;
  const runLabel = `Scheduled send ${run.run_number} of ${run.total_runs}`;
  const logRow = (t: Row | null, action: string, status: string, detail: string) => ({
    event_id: run.event_id, channel: isSms ? "sms" : "whatsapp", action, status,
    recipient_name: clip(t?.name, 200), recipient_phone: t?.phone || null,
    message_title: clip(run.title, 120), detail: clip(detail, 500), user_email: run.created_by || null,
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  // Why messages failed (reason → how many), so the run's own line can say it — not only History.
  // Counts this call's part of the run (a long run continues over several calls).
  const reasons = new Map<string, number>();
  const failedFor = (reason: string) => reasons.set(reason, (reasons.get(reason) || 0) + 1);

  while (next < list.length) {
    if (outOfTime()) {
      await db.progress(id, next, sent, failed, skipped, true);   // hand the lease back; next minute carries on
      return summary("continues");
    }
    const logs: Row[] = [], sends: Row[] = [];
    // One delivery record per number (the reports / webhook update it later)
    const sendRow = (t: Row, extra: Row) => ({
      event_id: run.event_id, event_card_id: t.id || null, channel: isSms ? "sms" : "whatsapp",
      message_key: isSms ? (run.message_key || "custom") : (run.wa_image ? "card" : "text"),
      message_title: clip(run.title, 120), recipient_name: clip(t.name, 200), phone: t.phone,
      schedule_run_id: id, created_by: run.created_by || null, ...extra,
    });
    let batch: Row[];
    if (isSms) {
      batch = list.slice(next, next + SMS_BATCH);
      // One bulk request; a duplicate refusal (same first message within 24 hours) is worked
      // round in sendSmsMessages. A refusal keeps NextSMS's own reason.
      const post = async (path: string, body: Row) => {
        const res = await fetch(`${UPSTREAM}/api/sms/v2${path}`, {
          method: "POST", headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), body: JSON.stringify(body),
        });
        return { status: res.status, text: await res.text().catch(() => "") };
      };
      const out = await sendSmsMessages(post,
        batch.map((t) => ({ from: run.sender_id || Deno.env.get("SMS_SENDER_ID") || "NIKADI", to: t.phone, text: t.text })));
      batch.forEach((t, n) => {
        const problem = n >= out.problemFrom ? out.problem : "";
        const r = smsSendResult(problem ? undefined : out.answers[n]);
        const why = problem || (r.missing ? "no result from the SMS provider" : r.reason);
        if (r.status === "failed") { failed++; failedFor(why || "not accepted by the SMS provider"); } else sent++;
        logs.push(logRow(t, "send", r.status, why ? `${runLabel} — ${why}` : runLabel));
        // No answer at all: the message may still have gone out, so the guest's status stays
        sends.push(sendRow(t, { message_id: r.messageId, status: r.status, status_id: r.statusId, status_group: r.groupId,
          status_name: r.statusName, reason: why || null, update_card: updatesStatus && !problem && !r.missing }));
      });
    } else {
      batch = [list[next]];
      const t = batch[0];
      let result: Row;
      try {
        const res = await fetch(`${UPSTREAM}/api/whatsapp/v2/text/single`, {
          method: "POST", headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          body: JSON.stringify({
            to: [Number(t.phone)],
            account: run.wa_account || "Nikadi",
            template: run.wa_template,
            ...(run.wa_image ? { header: { image: { file: t.cardUrl, name: t.name || "Event Card" } } } : {}),
          }),
        });
        result = classifyWaSend(res.status, await res.text().catch(() => ""));
      } catch (e) {
        result = { status: "not_sent", detail: (e as Error).message };
      }
      const ok = result.status === "sent" || result.status === "delivered" || result.status === "read";
      if (ok) sent++; else { failed++; failedFor(result.detail || "not accepted by the WhatsApp provider"); }
      logs.push(logRow(t, "send", result.status, result.detail ? `${runLabel} — ${result.detail}` : runLabel));
      const state = ok ? result.status : "failed";
      sends.push(sendRow(t, { message_id: result.messageId || null, status: state, status_id: result.statusId ?? null,
        status_group: result.groupId ?? null, status_name: result.statusName || null, reason: ok ? null : (result.detail || null),
        card_status: ok ? waCardStatus(state, result.statusId) : (result.status === "invalid" ? "invalid" : "notSent"),
        update_card: updatesStatus }));
    }
    next += batch.length;
    await db.logs(logs);
    await db.recordSends(sends);
    if (!(await db.progress(id, next, sent, failed, skipped))) return summary("stopped");   // cancelled or paused
    if (!isSms && next < list.length) await sleep(WA_GAP_MS);
  }

  // e.g. "0/5 SMS sent · 5 failed (HTTP 401) · 1 skipped: 1 invalid number"
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const failedText = failed ? `${failed} failed${top ? ` (${clip(top, 160)}${reasons.size > 1 ? ", and other reasons" : ""})` : ""}` : "";
  const detail = [list.length ? `${sent}/${list.length} ${word} sent` : `Nobody to send to`, failedText, note]
    .filter(Boolean).join(" · ");
  const status = list.length && !sent ? "failed" : "done";
  await db.logs([logRow(null, "bulk", status === "failed" ? "failed" : "ok", `${runLabel}: ${detail}`)]);
  await db.finish(id, status, detail);
  return summary(status);
};

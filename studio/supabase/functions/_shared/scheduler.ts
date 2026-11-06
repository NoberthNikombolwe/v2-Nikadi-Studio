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
//   4. after every batch: history rows (event_logs), guest statuses for main-SMS / card
//      sends, and save_run_progress(), which also says stop when the run was cancelled
//      or its schedule paused
//   5. finish_schedule_run() closes the run and updates the schedule's counts
// Responses carry counts only — never phone numbers or message text.
//
// Deploy: npx supabase functions deploy run-schedules --no-verify-jwt
// Secrets: CRON_SECRET (same value as the Vault secret nikadi_cron_secret), SMS_BEARER_TOKEN,
// optional WA_BEARER_TOKEN / SMS_SENDER_ID. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by the platform.

import { UPSTREAM, cleanToken } from "./proxy.ts";
import { scheduleTargets, describeTargetSkips, matchSmsResults, smsStatusFromGroup, classifyWaSend } from "./messaging.js";

const BUDGET_MS = 35_000;            // + one request's timeout stays under pg_net's 60 s
const UPSTREAM_TIMEOUT_MS = 20_000;
const DB_TIMEOUT_MS = 15_000;
const SMS_BATCH = 100;
const WA_GAP_MS = 1_000;             // same pacing as Send All in the app

type Row = Record<string, any>;
export type SchedulerOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Compares two secrets in constant time (no early exit on the first different character)
export const sameSecret = (a: string, b: string): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const clip = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, max));

// PostgREST calls with the service role key
const database = (url: string, key: string) => {
  const call = async (path: string, init: RequestInit = {}, prefer?: string): Promise<any> => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Database error ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  const rpc = (fn: string, args: Row) => call(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  return {
    claim: async (): Promise<Row | null> => {
      const rows = await rpc("claim_schedule_run", {});
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },
    cards: (eventId: string): Promise<Row[]> =>
      call(`event_cards?event_id=eq.${encodeURIComponent(eventId)}&select=id,name,card_type,phone,wa_status,sms_status,call_status,card_url&order=created_at`),
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
    cardStatuses: (items: Row[]) => (items.length ? rpc("set_card_send_statuses", { p_items: items }) : Promise.resolve(0)),
    logs: (rows: Row[]) => (rows.length ? call("event_logs", { method: "POST", body: JSON.stringify(rows) }, "return=minimal") : Promise.resolve(null)),
  };
};
type Db = ReturnType<typeof database>;

// The browser's WA status values (App.jsx `WA`) and the history's status names
const WA_CARD_STATUS: Record<string, string> = { sent: "sent", invalid: "invalid", not_sent: "notSent" };

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

  while (next < list.length) {
    if (outOfTime()) {
      await db.progress(id, next, sent, failed, skipped, true);   // hand the lease back; next minute carries on
      return summary("continues");
    }
    const logs: Row[] = [], cards: Row[] = [];
    let batch: Row[];
    if (isSms) {
      batch = list.slice(next, next + SMS_BATCH);
      let groupIds: (number | undefined)[] = batch.map(() => undefined);
      let problem = "";
      try {
        const res = await fetch(`${UPSTREAM}/api/sms/v2/text/multi`, {
          method: "POST", headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          body: JSON.stringify({
            messages: batch.map((t) => ({ from: run.sender_id || Deno.env.get("SMS_SENDER_ID") || "NIKADI", to: t.phone, text: t.text })),
            flash: 0,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json().catch(() => null);
        groupIds = matchSmsResults(batch.map((t) => t.phone), data?.messages || []);
      } catch (e) {
        problem = (e as Error).message;
      }
      batch.forEach((t, n) => {
        const status = smsStatusFromGroup(groupIds[n]);
        if (status === "failed") failed++; else sent++;
        logs.push(logRow(t, "send", status, problem ? `${runLabel} — ${problem}`
          : groupIds[n] === undefined ? `${runLabel} — no result from the SMS provider` : runLabel));
        if (updatesStatus && t.id && groupIds[n] !== undefined) cards.push({ id: t.id, sms_status: status });
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
      if (result.status === "sent") sent++; else failed++;
      logs.push(logRow(t, "send", result.status, result.detail ? `${runLabel} — ${result.detail}` : runLabel));
      if (updatesStatus && t.id) cards.push({ id: t.id, wa_status: WA_CARD_STATUS[result.status] || "notSent" });
    }
    next += batch.length;
    await db.logs(logs);
    await db.cardStatuses(cards);
    if (!(await db.progress(id, next, sent, failed, skipped))) return summary("stopped");   // cancelled or paused
    if (!isSms && next < list.length) await sleep(WA_GAP_MS);
  }

  const detail = [list.length ? `${sent}/${list.length} ${word} sent` : `Nobody to send to`, failed ? `${failed} failed` : "", note]
    .filter(Boolean).join(" · ");
  const status = list.length && !sent ? "failed" : "done";
  await db.logs([logRow(null, "bulk", status === "failed" ? "failed" : "ok", `${runLabel}: ${detail}`)]);
  await db.finish(id, status, detail);
  return summary(status);
};

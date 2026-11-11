// Tests for the run-schedules Edge Function. Run with `npm run test:functions` (Node >= 22.18).
// `Deno.env`, the database (PostgREST) and the SMS / WhatsApp provider are faked below.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createScheduler, sameSecret } from "./scheduler.ts";
import { buildLogRow } from "../../../src/lib/history.js";

const DB = "https://proj.supabase.co/rest/v1/";
const SMS_MULTI = "https://messaging-service.co.tz/api/sms/v2/text/multi";
const SMS_SINGLE = "https://messaging-service.co.tz/api/sms/v2/text/single";
const WA_SINGLE = "https://messaging-service.co.tz/api/whatsapp/v2/text/single";
const EVENT = "11111111-1111-1111-1111-111111111111";

type Call = { url: string; body: any; headers: Headers };
let env: Record<string, string>;
let calls: Call[];
let claims: any[];
let cards: any[];
let storedTargets: Record<string, any>;
let progressOk: (n: number) => boolean;
let smsReply: (body: any) => Response;
let smsSingleReply: (body: any) => Response;
let waReply: (body: any) => Response;
let clock: number;
let progress: any[], finished: any[], statuses: any[], recorded: any[], logs: any[], sleeps: number[];
let pending: any[], applied: any[], reportsReply: (url: string) => Response;

const run = (over: Record<string, unknown> = {}) => ({
  run_id: "run-1", schedule_id: "sch-1", event_id: EVENT, run_at: "2026-11-09T06:00:00Z", next_index: 0,
  sent: 0, failed: 0, skipped: 0, run_number: 3, total_runs: 30, has_targets: false,
  channel: "sms", title: "Reminder", body: "Hi {name}, see you!", message_key: "main", sender_id: "NIKADI",
  wa_template: null, wa_account: null, wa_image: false, audience: "all", created_by: "owner@example.com", event_name: "Wedding",
  ...over,
});

beforeEach(() => {
  env = { CRON_SECRET: "cron-secret-123", SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", SMS_BEARER_TOKEN: '"Bearer provider-token"' };
  calls = []; claims = []; storedTargets = {}; progress = []; finished = []; statuses = []; recorded = []; logs = []; sleeps = [];
  pending = []; applied = [];
  reportsReply = () => new Response('{"results":[]}', { status: 200 });
  clock = 0;
  progressOk = () => true;
  cards = [
    { id: "c1", name: "Asha", card_type: "Double", phone: "0712000001", sms_status: "pending", wa_status: "idle", call_status: "yes", card_url: "https://x/c1.jpg" },
    { id: "c2", name: "Juma", card_type: "Single", phone: "0712000002", sms_status: "sent", wa_status: "idle", call_status: null, card_url: null },
    { id: "c3", name: "Bad", card_type: "", phone: "123", sms_status: "pending" },
  ];
  smsReply = (body) => new Response('{"messages":[' + body.messages.map((m: any, i: number) =>
    `{"to":${Number(m.to)},"messageId":739182736451237888${i},"status":{"groupId":18,"groupName":"PENDING","id":51,"name":"ENROUTE (SENT)"}}`).join(",") + "]}", { status: 200 });
  waReply = () => new Response(JSON.stringify({ messages: [{ messageId: "m", status: { groupId: 18, id: 7 } }] }), { status: 200 });
  smsSingleReply = (body) => new Response(`{"messages":[{"to":${Number(body.to)},"messageId":7391827364512379999,"status":{"groupId":18,"id":51,"name":"ENROUTE (SENT)"}}]}`, { status: 200 });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: new Headers(init.headers) });
    const ok = (v: unknown) => new Response(v === undefined ? "" : JSON.stringify(v), { status: 200 });
    if (url === `${DB}rpc/claim_schedule_run`) return ok(claims.length ? [claims.shift()] : []);
    if (url.startsWith(`${DB}event_cards?`)) return ok(cards);
    if (url.startsWith(`${DB}message_run_targets?on_conflict`)) { storedTargets[body.run_id] = body.targets; return ok(undefined); }
    if (url.startsWith(`${DB}message_run_targets?run_id=eq.`)) { const id = decodeURIComponent(url.split("eq.")[1].split("&")[0]); return ok(storedTargets[id] ? [{ targets: storedTargets[id] }] : []); }
    if (url === `${DB}rpc/save_run_progress`) { progress.push(body); return ok(progressOk(progress.length)); }
    if (url === `${DB}rpc/finish_schedule_run`) { finished.push(body); return ok(true); }
    if (url === `${DB}rpc/record_message_sends`) {
      recorded.push(...body.p_items);
      // what record_message_sends does to the guests (main SMS / card, unless update_card is false)
      for (const it of body.p_items) {
        if (it.update_card === false || !it.event_card_id) continue;
        if (it.channel === "sms" && it.message_key === "main") statuses.push({ id: it.event_card_id, sms_status: it.status });
        if (it.channel === "whatsapp" && it.message_key === "card") statuses.push({ id: it.event_card_id, wa_status: it.card_status });
      }
      return ok(body.p_items.length);
    }
    if (url === `${DB}rpc/claim_pending_deliveries`) { const due = pending; pending = []; return ok(due); }
    if (url === `${DB}rpc/apply_delivery_results`) {
      applied.push(body);
      const n = body.p_items.length;
      return ok({ updated: n, delivered: body.p_items.filter((i: any) => i.status_id === 73).length, read: 0, failed: body.p_items.filter((i: any) => i.status_id === 76).length, unknown: 0 });
    }
    if (url.startsWith("https://messaging-service.co.tz/api/v2/reports")) return reportsReply(url);
    if (url === `${DB}event_logs`) { logs.push(...body); return ok(undefined); }
    if (url === SMS_MULTI) { clock += 100; return smsReply(body); }
    if (url === SMS_SINGLE) { clock += 100; return smsSingleReply(body); }
    if (url === WA_SINGLE) { clock += 100; return waReply(body); }
    return new Response("not found", { status: 404 });
  };
});

const scheduler = (budgetMs = 35_000) => createScheduler({ now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, budgetMs });
const post = (secret: string | null = "cron-secret-123", method = "POST", body = "{}") =>
  new Request("https://proj.supabase.co/functions/v1/run-schedules", { method, headers: secret === null ? {} : { "x-cron-secret": secret }, ...(method === "POST" ? { body } : {}) });
const upstream = () => calls.filter((c) => c.url.startsWith("https://messaging-service.co.tz"));
// Every history row the function writes must be one the app accepts
const assertValidLogs = () => logs.forEach((r) => buildLogRow(r.event_id, {
  channel: r.channel, action: r.action, status: r.status, name: r.recipient_name, phone: r.recipient_phone, title: r.message_title, detail: r.detail,
}));

test("only POST with the right secret gets in", async () => {
  assert.equal((await scheduler()(post("cron-secret-123", "GET"))).status, 405);
  assert.equal((await scheduler()(post(null))).status, 401);
  assert.equal((await scheduler()(post("wrong-secret-123"))).status, 401);
  assert.equal(calls.length, 0);
  delete env.CRON_SECRET;
  assert.equal((await scheduler()(post())).status, 500);
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("", ""), false);
});

test("nothing due: one claim, no provider call", async () => {
  const res = await scheduler()(post());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, runs: [] });
  assert.equal(upstream().length, 0);
});

test("a due main SMS run sends one batch with the server token, records history and statuses", async () => {
  claims = [run()];
  const res = await scheduler()(post());
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.runs, [{ run_id: "run-1", state: "done", sent: 2, failed: 0, skipped: 1 }]);
  const [sms] = upstream();
  assert.equal(sms.url, SMS_MULTI);
  assert.equal(sms.headers.get("Authorization"), "Bearer provider-token");
  assert.deepEqual(sms.body, { messages: [
    { from: "NIKADI", to: "255712000001", text: "Hi Asha, see you!" },
    { from: "NIKADI", to: "255712000002", text: "Hi Juma, see you!" },
  ], flash: 0 });
  // the database calls use the service role, never the provider token
  assert.ok(calls.filter(c => c.url.startsWith(DB)).every(c => c.headers.get("Authorization") === "Bearer service-key"));
  assert.deepEqual(statuses, [{ id: "c1", sms_status: "sent" }, { id: "c2", sms_status: "sent" }]);
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map(l => [l.action, l.status, l.recipient_phone]), [["send", "sent", "255712000001"], ["send", "sent", "255712000002"], ["bulk", "ok", null]]);
  assert.equal(logs[0].detail, "Scheduled send 3 of 30");
  assert.equal(logs[0].user_email, "owner@example.com");
  assert.equal(logs[2].detail, "Scheduled send 3 of 30: 2/2 SMS sent · 1 skipped: 1 invalid number");
  assertValidLogs();
  assert.deepEqual(finished, [{ p_run_id: "run-1", p_status: "done", p_detail: "2/2 SMS sent · 1 skipped: 1 invalid number" }]);
  assert.equal(storedTargets["run-1"].list.length, 2);
  // every send is recorded with the provider's messageId kept exact, so delivery reports can find it
  assert.deepEqual(recorded.map(r => [r.event_card_id, r.message_id, r.status, r.status_id, r.message_key, r.schedule_run_id, r.created_by]), [
    ["c1", "7391827364512378880", "sent", 51, "main", "run-1", "owner@example.com"],
    ["c2", "7391827364512378881", "sent", 51, "main", "run-1", "owner@example.com"]]);
  // the response never carries phone numbers
  assert.ok(!JSON.stringify(out).includes("2557"));
});

test("a reminder (not the main SMS) leaves guest statuses alone; the audience is applied", async () => {
  claims = [run({ message_key: "custom", audience: "confirmed" })];
  await scheduler()(post());
  assert.equal(upstream()[0].body.messages.length, 1);
  assert.equal(statuses.length, 0);
  assert.match(finished[0].p_detail, /1\/1 SMS sent · 2 skipped: 2 not in this audience/);
});

test("guests left off a newer spreadsheet (in_list false) get no scheduled send", async () => {
  cards = [...cards, { id: "c4", name: "Old guest", card_type: "Single", phone: "0712000004", sms_status: "pending", wa_status: "idle", call_status: "yes", in_list: false }];
  claims = [run()];
  await scheduler()(post());
  const sent = upstream()[0].body.messages.map((m: any) => m.to);
  assert.deepEqual(sent, ["255712000001", "255712000002"]);
  assert.ok(calls.some(c => c.url.startsWith(`${DB}event_cards?`) && c.url.includes("select=*")));
});

test("the provider failing marks the run failed with the reason", async () => {
  claims = [run()];
  smsReply = () => new Response("down", { status: 503 });
  await scheduler()(post());
  assert.deepEqual(logs.filter(l => l.action === "send").map(l => [l.status, l.detail]), [
    ["failed", "Scheduled send 3 of 30 — HTTP 503: down"], ["failed", "Scheduled send 3 of 30 — HTTP 503: down"]]);
  assert.equal(statuses.length, 0);   // no result from the provider → statuses untouched
  assert.equal(finished[0].p_status, "failed");
  assert.match(finished[0].p_detail, /^0\/2 SMS sent · 2 failed \(HTTP 503: down\)/);   // the run's line says why
});

test("a duplicate refusal (same first message within 24 hours) is worked round: first alone, then the rest", async () => {
  claims = [run()];
  const dup = () => new Response('{"message":"Duplicate request sent within past 24 hour(s)"}', { status: 422 });
  const normal = smsReply;
  let multiCalls = 0;
  smsReply = (body) => (++multiCalls === 1 ? dup() : normal(body));
  await scheduler()(post());
  const sms = upstream();
  assert.deepEqual(sms.map(c => [c.url.split("/").pop(), c.body.messages ? c.body.messages.map((m: any) => m.to) : [c.body.to]]), [
    ["multi", ["255712000001", "255712000002"]],   // refused: its first message repeats a recent one
    ["single", ["255712000001"]],                  // that message alone (no duplicate rule on single)
    ["multi", ["255712000002"]],                   // the rest, now led by another message
  ]);
  assert.deepEqual(sms[1].body, { from: "NIKADI", to: "255712000001", text: "Hi Asha, see you!", flash: 0 });
  assert.equal(finished[0].p_status, "done");
  assert.match(finished[0].p_detail, /^2\/2 SMS sent/);
  assert.deepEqual(recorded.map(r => r.message_id), ["7391827364512379999", "7391827364512378880"]);
  assertValidLogs();
});

test("a refused request keeps NextSMS's own reason", async () => {
  claims = [run()];
  smsReply = () => new Response('{"message":"Duplicate request sent within past 24 hour(s)"}', { status: 422 });
  smsSingleReply = () => new Response('{"message":"Unauthenticated."}', { status: 401 });
  await scheduler()(post());
  assert.match(finished[0].p_detail, /2 failed \(HTTP 401: Unauthenticated\.\)/);
  assertValidLogs();
});

test("numbers the provider refuses: the run's line names the commonest reason", async () => {
  claims = [run()];
  smsReply = (body) => new Response('{"messages":[' + body.messages.map((m: any, i: number) =>
    `{"to":${Number(m.to)},"messageId":"9${i}","status":{"groupId":22,"id":57,"name":"FAILED_NOT_ENOUGH_CREDITS"}}`).join(",") + "]}", { status: 200 });
  await scheduler()(post());
  assert.equal(finished[0].p_status, "failed");
  assert.match(finished[0].p_detail, /^0\/2 SMS sent · 2 failed \(FAILED_NOT_ENOUGH_CREDITS — Not enough SMS credit\)/);
});

test("no provider token: the run fails without calling the provider", async () => {
  delete env.SMS_BEARER_TOKEN;
  claims = [run()];
  await scheduler()(post());
  assert.equal(upstream().length, 0);
  assert.equal(finished[0].p_status, "failed");
  assert.match(finished[0].p_detail, /token is not set/);
});

test("a WhatsApp card run sends one guest at a time with its card; guests without a card are skipped", async () => {
  cards.push({ id: "c4", name: "Neema", card_type: "VIP", phone: "0712000004", wa_status: "sent", card_url: "https://x/c4.jpg" });
  claims = [run({ channel: "whatsapp", body: null, message_key: "card", wa_template: "Mwaliko", wa_account: "Nikadi", wa_image: true })];
  waReply = (body) => new Response(JSON.stringify({ messages: [{ messageId: "m", status: body.to[0] === 255712000004 ? { groupId: 20, id: 76 } : { groupId: 18, id: 7 } }] }), { status: 200 });
  await scheduler()(post());
  const wa = upstream();
  assert.equal(wa.length, 2);
  assert.deepEqual(wa[0].body, { to: [255712000001], account: "Nikadi", template: "Mwaliko", header: { image: { file: "https://x/c1.jpg", name: "Asha" } } });
  assert.equal(wa[0].headers.get("Authorization"), "Bearer provider-token");   // WA falls back to the SMS token
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(statuses, [{ id: "c1", wa_status: "sent" }, { id: "c4", wa_status: "invalid" }]);
  assert.deepEqual(logs.filter(l => l.action === "send").map(l => l.status), ["sent", "invalid"]);
  assert.match(finished[0].p_detail, /1\/2 WhatsApp sent · 1 failed \(number not on WhatsApp\) · 2 skipped: 1 invalid number, 1 no card uploaded/);
  assertValidLogs();
});

test("a text-only WhatsApp template sends without an image and leaves card statuses alone", async () => {
  env.WA_BEARER_TOKEN = "wa-token";
  claims = [run({ channel: "whatsapp", body: null, message_key: "text", wa_template: "Kumbusho", wa_account: "Nikadi", wa_image: false })];
  await scheduler()(post());
  const wa = upstream();
  assert.equal(wa.length, 2);
  assert.equal(wa[0].body.header, undefined);
  assert.equal(wa[0].headers.get("Authorization"), "Bearer wa-token");
  assert.equal(statuses.length, 0);
});

test("out of time: the lease is handed back with progress kept, and the next call carries on", async () => {
  cards = Array.from({ length: 4 }, (_, i) => ({ id: `w${i}`, name: `G${i}`, phone: `071200001${i}`, card_url: `https://x/${i}.jpg` }));
  claims = [run({ channel: "whatsapp", body: null, wa_template: "Mwaliko", wa_image: true })];
  const first = await (await scheduler(1500)(post())).json();
  assert.equal(first.runs[0].state, "continues");
  assert.equal(upstream().length, 2);
  assert.deepEqual(progress.at(-1), { p_run_id: "run-1", p_next_index: 2, p_sent: 2, p_failed: 0, p_skipped: 0, p_release: true });
  assert.equal(finished.length, 0);
  // next minute: the same run comes back with its saved list and position
  clock = 0;
  claims = [run({ channel: "whatsapp", body: null, wa_template: "Mwaliko", wa_image: true, has_targets: true, next_index: 2, sent: 2 })];
  const second = await (await scheduler()(post())).json();
  assert.equal(second.runs[0].state, "done");
  assert.deepEqual(upstream().slice(2).map(c => c.body.to[0]), [255712000012, 255712000013]);
  assert.equal(finished[0].p_detail, "4/4 WhatsApp sent");
});

test("a run cancelled (or paused) halfway stops before the next send", async () => {
  cards = Array.from({ length: 3 }, (_, i) => ({ id: `w${i}`, name: `G${i}`, phone: `071200001${i}`, card_url: `https://x/${i}.jpg` }));
  claims = [run({ channel: "whatsapp", body: null, wa_template: "Mwaliko", wa_image: true })];
  progressOk = (n) => n < 2;   // the list is saved, then the first send's save says stop
  const out = await (await scheduler()(post())).json();
  assert.equal(out.runs[0].state, "stopped");
  assert.equal(upstream().length, 1);
  assert.equal(finished.length, 0);
});

test("an SMS the provider refuses is recorded as failed with its reason", async () => {
  claims = [run()];
  smsReply = () => new Response('{"messages":[{"to":"255712000001","status":{"groupId":19,"id":58,"name":"FAILED_SENDER"},"sendReference":7391827364512378880},'
    + '{"to":"255712000002","messageId":7391827364512378882,"status":{"groupId":20,"id":76,"name":"UNDELIVERABLE"}}]}', { status: 200 });
  await scheduler()(post());
  assert.deepEqual(recorded.map(r => [r.status, r.message_id, r.reason]), [
    ["failed", null, "FAILED_SENDER — Sender ID not registered on that network"],
    ["failed", "7391827364512378882", "UNDELIVERABLE — Cannot be delivered — the number may not exist"]]);
  assert.deepEqual(statuses, [{ id: "c1", sms_status: "failed" }, { id: "c2", sms_status: "failed" }]);   // group 20 is not "delivered" by itself
  assert.equal(finished[0].p_status, "failed");
  assertValidLogs();
});

test("deliveries task: looks reports up by messageId per channel and applies them", async () => {
  pending = [{ message_id: "7391827364512378881", channel: "sms" }, { message_id: "7391827364512378882", channel: "sms" }, { message_id: "W1", channel: "whatsapp" }];
  reportsReply = (url) => new Response(url.includes("channel=sms")
    ? '{"results":[{"messageId":"7391827364512378881","doneAt":"2026-11-07 10:15:07","status":{"groupId":20,"id":73,"name":"DELIVERED"}},'
      + '{"messageId":7391827364512378882,"status":{"groupId":20,"id":76,"name":"UNDELIVERABLE"}}]}'
    : '{"results":[]}', { status: 200 });
  const res = await scheduler()(post("cron-secret-123", "POST", '{"task":"deliveries"}'));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.deliveries, { checked: 3, updated: 2, delivered: 1, read: 0, failed: 1, unknown: 0, errors: 0 });
  const lookups = upstream().map(c => c.url);
  assert.deepEqual(lookups, [
    "https://messaging-service.co.tz/api/v2/reports?channel=sms&size=200&messageId=7391827364512378881&messageId=7391827364512378882",
    "https://messaging-service.co.tz/api/v2/reports?channel=whatsapp&size=200&messageId=W1"]);
  assert.ok(upstream().every(c => c.headers.get("Authorization") === "Bearer provider-token"));
  assert.equal(applied.length, 1);   // nothing to apply for WhatsApp
  assert.equal(applied[0].p_source, "check");
  assert.deepEqual(applied[0].p_items, [
    { message_id: "7391827364512378881", status_id: 73, group_id: 20, status_name: "DELIVERED", done_at: "2026-11-07T10:15:07+03:00", reason: "DELIVERED — Delivered to the phone" },
    { message_id: "7391827364512378882", status_id: 76, group_id: 20, status_name: "UNDELIVERABLE", done_at: null, reason: "UNDELIVERABLE — Cannot be delivered — the number may not exist" }]);
  // the scheduled-send claim is not used by this task
  assert.ok(!calls.some(c => c.url === `${DB}rpc/claim_schedule_run`));
});

test("deliveries task: nothing due → no provider call; a provider error is counted", async () => {
  const res = await scheduler()(post("cron-secret-123", "POST", '{"task":"deliveries"}'));
  assert.deepEqual((await res.json()).deliveries, { checked: 0, updated: 0, delivered: 0, read: 0, failed: 0, unknown: 0, errors: 0 });
  assert.equal(upstream().length, 0);
  pending = [{ message_id: "1", channel: "sms" }];
  reportsReply = () => new Response("down", { status: 503 });
  const res2 = await scheduler()(post("cron-secret-123", "POST", '{"task":"deliveries"}'));
  assert.equal((await res2.json()).deliveries.errors, 1);
  assert.equal(applied.length, 0);
  // the deliveries task needs the cron secret too
  assert.equal((await scheduler()(post("wrong", "POST", '{"task":"deliveries"}'))).status, 401);
});

test("before the delivery SQL exists: the batch still finishes once (no repeat send) and guest statuses are set the old way", async () => {
  claims = [run()];
  const realFetch = (globalThis as any).fetch;
  const oldStatuses: any[] = [];
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    if (url === `${DB}rpc/record_message_sends`) return new Response('{"message":"Could not find the function public.record_message_sends"}', { status: 404 });
    if (url === `${DB}rpc/set_card_send_statuses`) { oldStatuses.push(...JSON.parse(String(init.body)).p_items); return new Response("2", { status: 200 }); }
    return realFetch(url, init);
  };
  const res = await scheduler()(post());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).runs[0].state, "done");
  assert.equal(upstream().length, 1);                       // sent once
  assert.equal(finished.length, 1);                         // and the run is closed, so it is never sent again
  assert.deepEqual(oldStatuses, [{ id: "c1", sms_status: "sent" }, { id: "c2", sms_status: "sent" }]);
});

test("a History write that fails after sending doesn't make the batch go out again", async () => {
  claims = [run()];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) =>
    url === `${DB}event_logs` ? new Response("boom", { status: 500 }) : realFetch(url, init);
  const res = await scheduler()(post());
  assert.equal(res.status, 200);
  assert.equal(upstream().length, 1);
  assert.equal(finished[0].p_status, "done");
});

// Tests for the delivery-webhook Edge Function. Run with `npm run test:functions` (Node >= 22.18).
// `Deno.env` and the database (PostgREST) are faked below.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDeliveryWebhook } from "./webhook.ts";

const DB = "https://proj.supabase.co/rest/v1/";
let env: Record<string, string>;
let calls: { url: string; body: any; headers: Headers }[];
let dbReply: (url: string, body: any) => Response;

beforeEach(() => {
  env = { NEXTSMS_CALLBACK_TOKEN: "verify-token-123", SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  calls = [];
  dbReply = (url, body) => new Response(JSON.stringify(url.endsWith("apply_delivery_results")
    ? { updated: body.p_items.length, delivered: 1, read: 0, failed: 0, unknown: 0 } : true), { status: 200 });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: new Headers(init.headers) });
    return dbReply(url, body);
  };
});

const hook = createDeliveryWebhook();
const send = (body: unknown, method = "POST") => hook(new Request("https://proj.supabase.co/functions/v1/delivery-webhook", {
  method, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
}));

test("the dashboard's test request (no messageId) gets 200 and changes nothing", async () => {
  for (const body of ["", "{}", '{"token":"anything"}', "not json", '{"test":true}']) {
    const res = await send(body);
    assert.equal(res.status, 200, `body: ${body}`);
  }
  assert.equal((await send(null, "GET")).status, 200);
  assert.equal(calls.length, 0);
});

test("a result with a wrong or missing token is refused", async () => {
  assert.equal((await send({ token: "wrong-token-12", messageId: "1", status: "DELIVERED", id: "73" })).status, 401);
  assert.equal((await send({ messageId: "1", status: "DELIVERED", id: "73" })).status, 401);
  assert.equal(calls.length, 0);
  delete env.NEXTSMS_CALLBACK_TOKEN;
  assert.equal((await send({ token: "verify-token-123", messageId: "1", status: "DELIVERED", id: "73" })).status, 500);
  assert.equal((await send({}, "PUT")).status, 405);
});

test("a delivery result is applied in one database call, keeping the messageId exact", async () => {
  // a numeric messageId would lose its last digits with plain JSON.parse
  const res = await send('{"token":"verify-token-123","messageId":7391827364512378881,"status":"UNDELIVERABLE","id":"76"}');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, updated: 1, unknown: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DB}rpc/apply_delivery_results`);
  assert.equal(calls[0].headers.get("Authorization"), "Bearer service-key");
  assert.deepEqual(calls[0].body, {
    p_items: [{ message_id: "7391827364512378881", status_id: 76, status_name: "UNDELIVERABLE", reason: "UNDELIVERABLE — Cannot be delivered — the number may not exist" }],
    p_source: "callback",
  });
});

test("a WhatsApp button reply is stored", async () => {
  const res = await send({ token: "verify-token-123", messageId: "7391827364512378881", response: "Yes", payload: "confirm-1", text: "Yes" });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, `${DB}rpc/record_delivery_reply`);
  assert.deepEqual(calls[0].body, { p_message_id: "7391827364512378881", p_text: "Yes" });
});

test("a database problem answers 500 (the server check picks the result up later)", async () => {
  dbReply = () => new Response("boom", { status: 500 });
  assert.equal((await send({ token: "verify-token-123", messageId: "1", status: "DELIVERED", id: "73" })).status, 500);
  assert.equal((await send("x".repeat(20_000))).status, 413);
});

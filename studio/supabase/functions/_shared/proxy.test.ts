// Tests for the shared Edge Function proxy. Run with `npm run test:functions`
// (needs Node >= 22.18, which can import .ts directly; no Deno install required —
// `Deno.env` and `fetch` are mocked below).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createProxy } from "./proxy.ts";

type Call = { url: string; init?: RequestInit };
let env: Record<string, string>;
let calls: Call[];
let upstreamImpl: (url: string, init?: RequestInit) => Promise<Response>;

const proxy = createProxy({
  name: "send-sms",
  tokenEnv: ["SMS_BEARER_TOKEN"],
  routes: [
    { method: "POST", path: "/api/sms/v2/text/single" },
    { method: "GET",  path: "/api/v2/balance" },
  ],
});

beforeEach(() => {
  env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon", SMS_BEARER_TOKEN: "provider-secret" };
  calls = [];
  upstreamImpl = async () => new Response(JSON.stringify({ messages: [] }), { status: 200 });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "https://proj.supabase.co/auth/v1/user") {
      const auth = new Headers(init?.headers).get("Authorization");
      return auth === "Bearer user-jwt" ? new Response("{}", { status: 200 }) : new Response("{}", { status: 401 });
    }
    return upstreamImpl(url, init);
  };
});

const req = (path: string, init: RequestInit = {}, auth: string | null = "Bearer user-jwt") =>
  new Request(`https://proj.supabase.co/functions/v1/send-sms${path}`, {
    ...init,
    headers: { ...(auth ? { Authorization: auth } : {}), ...(init.headers as object) },
  });
const upstreamCalls = () => calls.filter((c) => c.url.startsWith("https://messaging-service.co.tz"));

test("OPTIONS preflight needs no auth", async () => {
  const res = await proxy(req("/api/v2/balance", { method: "OPTIONS" }, null));
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("Access-Control-Allow-Origin"));
});

test("rejects requests with no Authorization header", async () => {
  const res = await proxy(req("/api/v2/balance", {}, null));
  assert.equal(res.status, 401);
  assert.equal(upstreamCalls().length, 0);
});

test("rejects the bare anon/publishable key (not a user session)", async () => {
  const res = await proxy(req("/api/v2/balance", {}, "Bearer anon"));
  assert.equal(res.status, 401);
  assert.equal(upstreamCalls().length, 0);
});

test("rejects endpoints that are not allowlisted", async () => {
  const res = await proxy(req("/api/sms/v2/reports"));
  assert.equal(res.status, 404);
  assert.equal(upstreamCalls().length, 0);
});

test("rejects the wrong method on an allowlisted endpoint", async () => {
  const res = await proxy(req("/api/v2/balance", { method: "POST", body: "{}" }));
  assert.equal(res.status, 405);
  assert.equal(upstreamCalls().length, 0);
});

test("forwards an allowed POST with the server-side token, never the user's", async () => {
  upstreamImpl = async () => new Response('{"ok":true}', { status: 201 });
  const res = await proxy(req("/api/sms/v2/text/single", { method: "POST", body: '{"to":"255712345678"}' }));
  assert.equal(res.status, 201);
  assert.equal(await res.text(), '{"ok":true}');
  const [call] = upstreamCalls();
  assert.equal(call.url, "https://messaging-service.co.tz/api/sms/v2/text/single");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer provider-secret");
  assert.equal(call.init?.body, '{"to":"255712345678"}');
});

test("GET is forwarded without a body", async () => {
  await proxy(req("/api/v2/balance"));
  const [call] = upstreamCalls();
  assert.equal(call.init?.method, "GET");
  assert.equal(call.init?.body, undefined);
});

test("works with or without the /functions/v1 routing prefix", async () => {
  const bare = new Request("https://proj.supabase.co/send-sms/api/v2/balance", { headers: { Authorization: "Bearer user-jwt" } });
  assert.equal((await proxy(bare)).status, 200);
  assert.equal((await proxy(req("/api/v2/balance"))).status, 200);
  assert.equal(upstreamCalls().length, 2);
});

test("fails closed when the provider secret is missing", async () => {
  delete env.SMS_BEARER_TOKEN;
  const res = await proxy(req("/api/v2/balance"));
  assert.equal(res.status, 500);
  assert.equal(upstreamCalls().length, 0);
});

test("rejects oversized request bodies", async () => {
  const res = await proxy(req("/api/sms/v2/text/single", { method: "POST", body: "x".repeat(1_000_001) }));
  assert.equal(res.status, 413);
  assert.equal(upstreamCalls().length, 0);
});

test("upstream failure returns a generic 502 without leaking details", async () => {
  upstreamImpl = async () => { throw new Error("secret internal detail"); };
  const res = await proxy(req("/api/v2/balance"));
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes("secret internal detail"));
});

test("ALLOWED_ORIGINS restricts the CORS origin", async () => {
  env.ALLOWED_ORIGINS = "https://app.example.com";
  const res = await proxy(req("/api/v2/balance", { headers: { Origin: "https://evil.example" } }));
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
});

// ── role checks (module option) ──
let permImpl: () => Promise<Response>;
const guarded = createProxy({
  name: "send-sms",
  tokenEnv: ["SMS_BEARER_TOKEN"],
  module: "sms",
  routes: [{ method: "POST", path: "/api/sms/v2/text/single" }, { method: "GET", path: "/api/v2/balance" }],
});
const withPerm = (impl: () => Promise<Response>) => {
  permImpl = impl;
  const base = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    if (url === "https://proj.supabase.co/rest/v1/rpc/has_perm") { calls.push({ url, init }); return permImpl(); }
    return base(url, init);
  };
};

test("role check: allowed role is forwarded, asking for edit on POST", async () => {
  withPerm(async () => new Response("true", { status: 200 }));
  const res = await guarded(req("/api/sms/v2/text/single", { method: "POST", body: "{}" }));
  assert.equal(res.status, 200);
  const perm = calls.find((c) => c.url.endsWith("/rpc/has_perm"))!;
  assert.deepEqual(JSON.parse(String(perm.init?.body)), { p_module: "sms", p_edit: true });
  assert.equal(new Headers(perm.init?.headers).get("Authorization"), "Bearer user-jwt");
  assert.equal(upstreamCalls().length, 1);
});

test("role check: a role without permission gets 403 and nothing is sent", async () => {
  withPerm(async () => new Response("false", { status: 200 }));
  const res = await guarded(req("/api/sms/v2/text/single", { method: "POST", body: "{}" }));
  assert.equal(res.status, 403);
  assert.equal(upstreamCalls().length, 0);
});

test("role check: GET only needs view permission", async () => {
  withPerm(async () => new Response("true", { status: 200 }));
  await guarded(req("/api/v2/balance"));
  const perm = calls.find((c) => c.url.endsWith("/rpc/has_perm"))!;
  assert.equal(JSON.parse(String(perm.init?.body)).p_edit, false);
});

test("role check: passes before the roles SQL is installed (has_perm missing)", async () => {
  withPerm(async () => new Response("{}", { status: 404 }));
  const res = await guarded(req("/api/sms/v2/text/single", { method: "POST", body: "{}" }));
  assert.equal(res.status, 200);
});

test("role check: fails closed when the permission lookup errors", async () => {
  withPerm(async () => new Response("{}", { status: 500 }));
  const res = await guarded(req("/api/sms/v2/text/single", { method: "POST", body: "{}" }));
  assert.equal(res.status, 403);
});

test("provider token is cleaned of a Bearer prefix, quotes and spaces", async () => {
  const { cleanToken } = await import("./proxy.ts");
  assert.equal(cleanToken("abc123"), "abc123");
  assert.equal(cleanToken("Bearer abc123"), "abc123");
  assert.equal(cleanToken('  "Bearer abc123"\n'), "abc123");
  assert.equal(cleanToken("'abc123'"), "abc123");
  assert.equal(cleanToken(undefined), "");
});

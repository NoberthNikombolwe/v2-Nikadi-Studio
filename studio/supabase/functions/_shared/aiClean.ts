// The ai-clean Edge Function: the Studio's "Clean data" chat asks Gemini through here.
//
// Rules, like the messaging proxy (proxy.ts):
//   1. Only a signed-in Supabase user may call it (the bare anon/publishable key is rejected).
//   2. The caller's role must see at least one Studio page (has_any_perm on the Studio
//      modules, view). Before the roles SQL exists any signed-in user passes.
//   3. The Gemini key is a server-side secret (GEMINI_API_KEY) and never reaches the browser.
//   4. The browser sends only the chat ({ messages: [{ role, text, images? }] }). The
//      instructions the bot follows are fixed in dataClean.js, so it can't be talked into
//      other work.
//   5. Photos of a guest list (images: [{ mime, data }], base64) are checked (type, size,
//      count) and passed straight to Gemini inside the question. Nothing is stored or logged:
//      no Storage upload, no Gemini Files API, no database row.
//
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional, defaults to the current Flash
// model alias). Deploy with --no-verify-jwt; rule 1 replaces the gateway's check.
import { corsHeaders, json, isSignedIn, cleanToken } from "./proxy.ts";
import { runCleanChat, CLEAN_LIMITS } from "./dataClean.js";

// The Studio pages (NAV_GROUPS "Studio" in App.jsx); seeing any of them is enough
export const STUDIO_MODULES = ["design", "vcard", "sms", "whatsapp", "batch"];
// A long list takes Gemini a while; stays under the Edge Function's 150 s request limit
const GEMINI_TIMEOUT_MS = 140_000;

// true / false from has_any_perm() as the caller; null when the roles SQL isn't installed yet
const studioAllowed = async (req: Request): Promise<boolean | null> => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/has_any_perm`, {
      method: "POST",
      headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_modules: STUDIO_MODULES, p_edit: false }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
};

export const createAiCleanHandler = () =>
  async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

    if (!(await isSignedIn(req))) return json(req, 401, { error: "Sign in required" });
    if ((await studioAllowed(req)) === false) return json(req, 403, { error: "Your role is not allowed to do this" });

    const apiKey = cleanToken(Deno.env.get("GEMINI_API_KEY"));
    if (!apiKey) return json(req, 500, { error: "The data cleaner is not set up (no GEMINI_API_KEY secret)." });

    if (Number(req.headers.get("content-length") ?? 0) > CLEAN_LIMITS.bodyBytes) {
      return json(req, 413, { error: "That message is too large — send a shorter list or fewer photos." });
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > CLEAN_LIMITS.bodyBytes) {
      return json(req, 413, { error: "That message is too large — send a shorter list or fewer photos." });
    }
    let payload: { messages?: unknown };
    try { payload = JSON.parse(raw); } catch { return json(req, 400, { error: "The request could not be read." }); }

    const out = await runCleanChat(payload?.messages, {
      apiKey,
      model: Deno.env.get("GEMINI_MODEL"),
      post: async (url: string, init: { headers: Record<string, string>; body: string }) => {
        const res = await fetch(url, { method: "POST", ...init, signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
        return { status: res.status, text: await res.text() };
      },
    });
    return json(req, out.status, out.body);
  };

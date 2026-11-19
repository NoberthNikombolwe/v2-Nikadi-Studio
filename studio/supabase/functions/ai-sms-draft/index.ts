import { corsHeaders, json, isSignedIn, cleanToken } from "../_shared/proxy.ts";
import { runSmsDraft, SMS_DRAFT_LIMITS } from "../_shared/aiSmsDraft.js";

// Draft an SMS invitation with Gemini.
// Deploy with --no-verify-jwt (the sign-in check below replaces it).
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional).
const GEMINI_TIMEOUT_MS = 60_000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  if (!(await isSignedIn(req))) return json(req, 401, { error: "Sign in required" });

  const apiKey = cleanToken(Deno.env.get("GEMINI_API_KEY"));
  if (!apiKey) return json(req, 500, { error: "AI SMS draft is not set up (no GEMINI_API_KEY secret)." });

  if (Number(req.headers.get("content-length") ?? 0) > SMS_DRAFT_LIMITS.bodyBytes)
    return json(req, 413, { error: "Request is too large." });

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > SMS_DRAFT_LIMITS.bodyBytes)
    return json(req, 413, { error: "Request is too large." });

  let payload: { event?: unknown; images?: unknown };
  try { payload = JSON.parse(raw); } catch { return json(req, 400, { error: "The request could not be read." }); }

  const out = await runSmsDraft(payload, {
    apiKey,
    model: Deno.env.get("GEMINI_MODEL"),
    post: async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const res = await fetch(url, { method: "POST", ...init, signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
      return { status: res.status, text: await res.text() };
    },
  });
  return json(req, out.status, out.body);
});

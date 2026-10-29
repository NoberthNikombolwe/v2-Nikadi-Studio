// Shared plumbing for the messaging-service.co.tz proxy Edge Functions (send-sms, send-wa).
//
// The browser can't call the provider directly (no CORS headers, and its bearer token
// must not ship in the bundle), so these functions sit in between. Three rules:
//   1. Only a signed-in Supabase user may call them — the caller's JWT is verified
//      against the Auth API. The bare anon/publishable key is rejected.
//   2. Only an explicit allowlist of provider endpoints is reachable (method + path),
//      so the function can't be used as a general-purpose relay to the account.
//   3. The provider bearer token comes from a server-side secret and is never
//      accepted from, or returned to, the client.
//
// Deploy with --no-verify-jwt (the project uses non-JWT publishable keys, which the
// gateway's legacy JWT check rejects); the check in this file replaces it.

const UPSTREAM = "https://messaging-service.co.tz";
const MAX_BODY_BYTES = 1_000_000;   // a bulk SMS batch is well under this
const UPSTREAM_TIMEOUT_MS = 25_000;

export type Route = { method: "GET" | "POST"; path: string };

export type ProxyOptions = {
  name: string;          // function name, used to strip the routing prefix
  tokenEnv: string[];    // secret names to read the provider token from, first set one wins
  routes: Route[];       // allowlisted provider endpoints
};

// CORS: set ALLOWED_ORIGINS (comma-separated) to restrict browsers to your app's origin(s).
// Left unset it falls back to "*", which is acceptable because auth is a bearer token,
// not a cookie — but restricting it is the recommended production setting.
const corsHeaders = (req: Request): Record<string, string> => {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
};

const json = (req: Request, status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

// True when the request carries a valid signed-in user's access token
const isSignedIn = async (req: Request): Promise<boolean> => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer \S+$/.test(auth)) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: key },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const createProxy = ({ name, tokenEnv, routes }: ProxyOptions) =>
  async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });

    if (!(await isSignedIn(req))) return json(req, 401, { error: "Sign in required" });

    // Hosted routing may or may not include the /functions/v1 prefix — strip either form
    const url = new URL(req.url);
    const upstreamPath = url.pathname.replace(new RegExp(`^(/functions/v1)?/${name}`), "");

    const route = routes.find((r) => r.path === upstreamPath);
    if (!route) return json(req, 404, { error: "Unknown endpoint" });
    if (route.method !== req.method) return json(req, 405, { error: "Method not allowed" });

    const token = tokenEnv.map((k) => Deno.env.get(k)).find(Boolean);
    if (!token) return json(req, 500, { error: "Server is not configured" });

    let body: string | undefined;
    if (req.method === "POST") {
      if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
        return json(req, 413, { error: "Request too large" });
      }
      body = await req.text();
      if (body.length > MAX_BODY_BYTES) return json(req, 413, { error: "Request too large" });
    }

    try {
      const upstream = await fetch(`${UPSTREAM}${upstreamPath}${url.search}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    } catch {
      return json(req, 502, { error: "Upstream request failed" });
    }
  };

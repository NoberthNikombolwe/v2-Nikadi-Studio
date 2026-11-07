// Shared pieces of the server-only Edge Functions (run-schedules, delivery-webhook): a
// PostgREST client with the service role key, a constant-time secret check and JSON replies.
// Plain fetch, so the tests can fake it without a Supabase project.

export type Row = Record<string, any>;
const DB_TIMEOUT_MS = 15_000;

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Compares two secrets in constant time (no early exit on the first different character)
export const sameSecret = (a: string, b: string): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const clip = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, max));

// PostgREST calls with the service role key: call(path, init, prefer) and rpc(name, args)
export const restClient = (url: string, key: string) => {
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
  return { call, rpc };
};
export type RestClient = ReturnType<typeof restClient>;

// The client for this project (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set by the
// platform); null when they are missing
export const serviceClient = (): RestClient | null => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? restClient(url, key) : null;
};

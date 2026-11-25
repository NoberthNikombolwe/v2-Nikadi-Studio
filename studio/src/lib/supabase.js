import { createClient } from "@supabase/supabase-js";

const SB_URL = import.meta.env.VITE_SUPABASE_URL  || "";
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const supabase = (SB_URL && SB_KEY) ? createClient(SB_URL, SB_KEY) : null;

/**
 * Production (Cloudflare Workers): CF Access has already authenticated the user.
 * The Worker's /api/session endpoint creates a Supabase session and returns the
 * tokens; we set that session here so all Supabase queries work with correct RLS.
 *
 * Development (Vite dev server): CF Access is not present — if a session already
 * exists in localStorage (from a previous OAuth sign-in) we keep it; otherwise
 * the caller shows the OAuth login page.
 *
 * Returns { ok: true } on success, or { ok: false, error, status? } on failure.
 */
export async function bootstrapSession() {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };

  // If a valid session already exists (e.g. from a previous sign-in or a
  // still-valid refresh token), skip the network round-trip.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return { ok: true };

  // Development: no Worker running — fall back to OAuth flow via LoginPage.
  if (import.meta.env.DEV) return { ok: false, error: "no_session" };

  // Production: ask the Worker to create a Supabase session for the
  // CF Access–authenticated user.
  try {
    const resp = await fetch("/api/session");
    const data = await resp.json();

    if (!resp.ok) return { ok: false, error: data.error ?? "session_error", status: resp.status };

    if (data.access_token && data.refresh_token) {
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message ?? "network_error" };
  }
}

/**
 * Signs the user out of Supabase and, in production, redirects to the
 * Cloudflare Access logout URL so the Google session is also cleared.
 */
export async function signOut() {
  await supabase?.auth.signOut();
  if (!import.meta.env.DEV) {
    window.location.href = "/cdn-cgi/access/logout";
  }
}

// No Supabase. Auth is handled by the Worker (Google OAuth + D1 sessions).
// This file keeps the same export shape so the rest of the app is unchanged.
import { db } from "./db.js";

export const supabase = db;

/**
 * Checks whether a session cookie exists (Worker already set it after Google login).
 * Returns { ok: true } when signed in, { ok: false, error } otherwise.
 */
export async function bootstrapSession() {
  try {
    const res = await fetch('/api/me');
    const { email } = await res.json();
    return email ? { ok: true } : { ok: false, error: 'no_session' };
  } catch {
    return { ok: false, error: 'no_session' };
  }
}

/**
 * Signs the user out — calls the Worker logout route which clears the session
 * cookie and deletes the row from D1.
 */
export async function signOut() {
  window.location.href = '/auth/logout';
}

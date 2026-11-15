// notify-rsvp — public Edge Function (no auth required).
// Called by the public guest page after a successful RSVP submission.
// Looks up the event owner's notification phone via service role, then
// sends a WhatsApp message to that number so they hear about RSVPs instantly.

import { serviceClient } from "../_shared/db.ts";
import { corsHeaders, cleanToken, UPSTREAM } from "../_shared/proxy.ts";

const WA_PATH = "/api/whatsapp/v2/text/single";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });

  const ch = corsHeaders(req);
  const ok200 = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...ch, "Content-Type": "application/json" } });
  const err = (status: number, msg: string) => new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { ...ch, "Content-Type": "application/json" } });

  let body: { event_public_id?: string; guest_name?: string; card_type?: string; attending?: boolean; message?: string };
  try { body = await req.json(); } catch { return err(400, "Bad request"); }

  const { event_public_id, guest_name, card_type, attending, message } = body;
  if (!event_public_id) return err(400, "Missing event_public_id");

  const db = serviceClient();
  if (!db) return err(500, "Server not configured");

  try {
    // Step 1: resolve event id
    const pubId = encodeURIComponent(event_public_id.toUpperCase());
    const events: Array<{ id: string }> = await db.call(
      `events?select=id&public_id=eq.${pubId}&guest_link_enabled=eq.true&limit=1`,
    );
    const eventId = events?.[0]?.id;
    if (!eventId) return ok200(); // event not found — silent, guest is not affected

    // Step 2: get notification phone from event_pages
    const pages: Array<{ rsvp_notify_phone: string | null }> = await db.call(
      `event_pages?select=rsvp_notify_phone&event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    const notifyPhone = pages?.[0]?.rsvp_notify_phone ?? null;
    if (!notifyPhone) return ok200(); // no phone configured

    const token = cleanToken(Deno.env.get("WA_BEARER_TOKEN") ?? Deno.env.get("SMS_BEARER_TOKEN"));
    if (!token) return ok200(); // not configured

    const attendingLabel = attending ? "Attending" : "Not attending";
    const nameLabel = guest_name || "Guest";
    const typeLabel = card_type ? ` (${card_type})` : "";
    let waText = `*RSVP Notification*\n${nameLabel}${typeLabel} - ${attendingLabel}`;
    if (message) waText += `\nMessage: ${message}`;

    await fetch(`${UPSTREAM}${WA_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: notifyPhone, message: waText }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { /* WA send failure is silent — guest submit already succeeded */ });
  } catch {
    // Any DB error is silent — guest submit already succeeded
  }

  return ok200();
});

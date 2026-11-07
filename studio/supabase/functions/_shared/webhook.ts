// The delivery-webhook Edge Function: NextSMS posts every delivery result here.
//
// Set it once in the NextSMS dashboard (Customer Profile → Customization → Webhooks):
//   Delivery Callback URL = https://<project-ref>.supabase.co/functions/v1/delivery-webhook
//   Verify Token          = the same value as the secret NEXTSMS_CALLBACK_TOKEN
// Payloads (JSON POST):
//   a result        {token, messageId, status: "DELIVERED", id: "73"}  (WhatsApp: SENT, DELIVERED, READ)
//   a button reply  {token, messageId, response, payload, text}
// The provider waits 5 seconds and never retries, so this answers fast with a single
// database call; the server check (deliveries.ts) picks up anything missed.
// Saving the URL in the dashboard sends a test request, which must get a 200: a request
// without a messageId changes nothing and always gets 200.
// Deploy: npx supabase functions deploy delivery-webhook --no-verify-jwt
// (the provider has no Supabase login — the Verify Token is the check).

import { cleanToken } from "./proxy.ts";
import { parseProviderJson, parseDeliveryCallback, statusReason } from "./messaging.js";
import { json, sameSecret, serviceClient } from "./db.ts";

const MAX_BODY = 10_000;

export const createDeliveryWebhook = () => async (req: Request): Promise<Response> => {
  if (req.method === "GET") return json(200, { ok: true });                 // reachability check
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "Request too large" });
  let body: unknown = null;
  try { body = raw ? parseProviderJson(raw) : null; } catch { body = null; }  // keeps a numeric messageId exact
  const msg = parseDeliveryCallback(body);
  if (msg.kind === "ping") return json(200, { ok: true });

  const secret = cleanToken(Deno.env.get("NEXTSMS_CALLBACK_TOKEN"));
  if (!secret) return json(500, { error: "Server is not configured" });
  if (!sameSecret(cleanToken(String((body as Record<string, unknown>)?.token ?? "")), secret)) return json(401, { error: "Not allowed" });
  const db = serviceClient();
  if (!db) return json(500, { error: "Server is not configured" });

  try {
    if (msg.kind === "reply") {
      const saved = await db.rpc("record_delivery_reply", { p_message_id: msg.message_id, p_text: msg.text });
      return json(200, { ok: true, saved: saved === true });
    }
    const out = await db.rpc("apply_delivery_results", {
      p_items: [{ message_id: msg.message_id, status_id: msg.status_id, status_name: msg.status_name,
        reason: statusReason(msg.status_id, msg.status_name) || null }],
      p_source: "callback",
    });
    return json(200, { ok: true, updated: Number(out?.updated) || 0, unknown: Number(out?.unknown) || 0 });
  } catch {
    return json(500, { error: "Could not save the result" });
  }
};

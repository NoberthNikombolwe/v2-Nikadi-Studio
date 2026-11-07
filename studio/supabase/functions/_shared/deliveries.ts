// Delivery report checks — run-schedules with the body {"task":"deliveries"}, which pg_cron
// sends every 5 minutes while a message is due a check (supabase-roles-settings-scan.sql §11).
//
//   1. claim_pending_deliveries() hands out messages still waiting (and stamps them checked)
//   2. GET /api/v2/reports?channel=…&messageId=…&messageId=… — 50 ids per call, by channel.
//      Always by messageId: a reports call WITHOUT messageId "uses the reports up" (each is
//      returned once), which would hide them from every later check (NextSMS docs).
//   3. apply_delivery_results() moves each message forwards, updates the guest and History.
// Messages still waiting after 3 days are no longer checked. The webhook usually gets there
// first; this catches what it missed (the provider never retries a callback).

import { UPSTREAM, cleanToken } from "./proxy.ts";
import { parseDeliveryReports, reportsQueries, statusReason } from "./messaging.js";
import type { RestClient, Row } from "./db.ts";

const UPSTREAM_TIMEOUT_MS = 20_000;
const CLAIM_LIMIT = 200;

export type DeliveryTotals = { checked: number; updated: number; delivered: number; read: number; failed: number; unknown: number; errors: number };

const tokenFor = (channel: string) => channel === "sms"
  ? cleanToken(Deno.env.get("SMS_BEARER_TOKEN"))
  : cleanToken(Deno.env.get("WA_BEARER_TOKEN")) || cleanToken(Deno.env.get("SMS_BEARER_TOKEN"));

export const syncDeliveries = async (db: RestClient, { outOfTime = () => false, limit = CLAIM_LIMIT } = {}): Promise<DeliveryTotals> => {
  const totals: DeliveryTotals = { checked: 0, updated: 0, delivered: 0, read: 0, failed: 0, unknown: 0, errors: 0 };
  const due: Row[] = await db.rpc("claim_pending_deliveries", { p_limit: limit });
  if (!Array.isArray(due) || !due.length) return totals;
  totals.checked = due.length;
  const ids: Record<string, string[]> = { sms: [], whatsapp: [] };
  due.forEach((r) => { if (ids[r.channel] && r.message_id) ids[r.channel].push(String(r.message_id)); });

  for (const channel of ["sms", "whatsapp"]) {
    if (!ids[channel].length) continue;
    const token = tokenFor(channel);
    if (!token) { totals.errors++; continue; }
    for (const query of reportsQueries(ids[channel], channel)) {
      if (outOfTime()) return totals;
      try {
        const res = await fetch(`${UPSTREAM}/api/v2/reports${query}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        const text = await res.text();
        if (!res.ok) { totals.errors++; continue; }
        const items = parseDeliveryReports(text).map((r: Row) => ({ ...r, reason: statusReason(r.status_id, r.status_name) || null }));
        if (!items.length) continue;
        const out = await db.rpc("apply_delivery_results", { p_items: items, p_source: "check" });
        for (const k of ["updated", "delivered", "read", "failed", "unknown"] as const) totals[k] += Number(out?.[k]) || 0;
      } catch {
        totals.errors++;
      }
    }
  }
  return totals;
};

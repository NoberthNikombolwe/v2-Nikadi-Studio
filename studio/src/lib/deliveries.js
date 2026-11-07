// Delivery results in the app: the open event's message_deliveries rows (one per message sent
// to one number, kept current by the webhook / server check / "Check delivery now") turned
// into what the screens show — each guest's latest result, the Reports counts, failure
// reasons, the delivery log and its Excel export, and the NextSMS account log.
import { recipientKey } from "./messages.js";
import { parseProviderJson, deliveryStateOf, statusReason, eatToIso } from "../../supabase/functions/_shared/messaging.js";

export const DELIVERY_STATES = {
  sent:      { label: "Waiting",   badge: "badge-sent",    icon: "arrowUp", hint: "Sent — waiting for the delivery report" },
  delivered: { label: "Delivered", badge: "badge-yes",     icon: "check",   hint: "Delivered to the phone" },
  read:      { label: "Read",      badge: "badge-purple",  icon: "checks",  hint: "Opened on WhatsApp" },
  failed:    { label: "Failed",    badge: "badge-no",      icon: "xCircle", hint: "Not delivered" },
};
export const DELIVERY_SOURCES = { send: "send", callback: "webhook", check: "check" };

const newer = (a, b) => !b || String(a.sent_at || "") >= String(b.sent_at || "");

// The latest delivery of each guest's main SMS / WhatsApp card, and of each extra message:
//   byCard:  "sms|main|<cardId>" / "whatsapp|card|<cardId>" → row
//   byExtra: "<messageKey>|<recipientKey>"                  → row (extra SMS messages)
export const indexDeliveries = (rows = []) => {
  const byCard = new Map(), byExtra = new Map();
  for (const d of rows) {
    if (!d) continue;
    if (d.event_card_id && ((d.channel === "sms" && d.message_key === "main") || (d.channel === "whatsapp" && d.message_key === "card"))) {
      const k = `${d.channel}|${d.message_key}|${d.event_card_id}`;
      if (newer(d, byCard.get(k))) byCard.set(k, d);
    } else if (d.channel === "sms" && d.message_key && !["main", "custom"].includes(d.message_key)) {
      const k = `${d.message_key}|${recipientKey({ phone: d.phone, name: d.recipient_name })}`;
      if (newer(d, byExtra.get(k))) byExtra.set(k, d);
    }
  }
  return { byCard, byExtra };
};

// The guest's SMS status for an extra message, with its delivery result on top of what the
// message stored when it was sent ("delivered" / "failed" once the report is in)
export const extraStatusOf = (index, messageKey, rec, stored) => {
  const d = index?.byExtra.get(`${messageKey}|${recipientKey(rec)}`);
  if (!d) return stored;
  return d.status === "read" ? "delivered" : d.status;
};

// One line about a delivery for a tooltip / the log: "UNDELIVERABLE — … · 7 Nov 10:15"
export const deliveryNote = (d) => {
  if (!d) return "";
  const when = d.done_at || d.sent_at;
  const t = when ? new Date(when).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const what = d.status === "failed" ? (d.reason || d.status_name || "Not delivered") : DELIVERY_STATES[d.status]?.hint || d.status;
  return [what, t].filter(Boolean).join(" · ");
};

// Reports counts from the guests' statuses (main SMS + WhatsApp card)
export const guestStatusCounts = (records = []) => {
  const guests = records.filter(r => !r.sample);
  const c = (pred) => guests.filter(pred).length;
  return {
    total: guests.length,
    sms: {
      delivered: c(r => r.smsStatus === "delivered"), sent: c(r => r.smsStatus === "sent"),
      failed: c(r => r.smsStatus === "failed"), notSent: c(r => !r.smsStatus || r.smsStatus === "pending"),
    },
    wa: {
      read: c(r => r.waStatus === "read"), delivered: c(r => r.waStatus === "delivered"), sent: c(r => r.waStatus === "sent"),
      invalid: c(r => r.waStatus === "invalid"), failed: c(r => r.waStatus === "notSent"),
      notSent: c(r => !r.waStatus || r.waStatus === "idle" || r.waStatus === "sending"),
    },
  };
};

// Counts over every message sent for the event (reminders, extra messages, schedules too)
export const deliveryCounts = (rows = []) => {
  const out = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, sms: 0, whatsapp: 0 };
  for (const d of rows) {
    out.total++;
    if (out[d.status] !== undefined) out[d.status]++;
    if (d.channel === "sms") out.sms++; else if (d.channel === "whatsapp") out.whatsapp++;
  }
  return out;
};

// Why messages failed, most common first: [{ reason, count, channel }]
export const failureReasons = (rows = []) => {
  const m = new Map();
  for (const d of rows) {
    if (d.status !== "failed") continue;
    const reason = d.reason || d.status_name || "Not delivered";
    const k = `${d.channel}|${reason}`;
    m.set(k, { reason, channel: d.channel, count: (m.get(k)?.count || 0) + 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
};

// Delivery log filters: q (name / phone / message / reason), channel, status ("all" or a state)
export const filterDeliveries = (rows = [], { q = "", channel = "all", status = "all" } = {}) => {
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, "").replace(/^0/, "");   // "0712 000 003" → "712000003" (phones are stored as 2557…)
  const matches = (d) => {
    if (!term) return true;
    if ([d.recipient_name, d.message_title, d.reason, d.status_name].some(v => String(v || "").toLowerCase().includes(term))) return true;
    return digits.length >= 4 && String(d.phone || "").includes(digits);
  };
  return rows.filter(d => (channel === "all" || d.channel === channel) && (status === "all" || d.status === status) && matches(d));
};

const fmt = (t) => (t ? new Date(t).toLocaleString("en-GB") : "");

// Rows for the delivery log Excel export
export const deliveryExportRows = (rows = []) => rows.map(d => ({
  "Sent": fmt(d.sent_at),
  "Guest": d.recipient_name || "",
  "Phone": d.phone ? `+${d.phone}` : "",
  "Channel": d.channel === "whatsapp" ? "WhatsApp" : "SMS",
  "Message": d.message_title || "",
  "Status": DELIVERY_STATES[d.status]?.label || d.status || "",
  "Provider status": d.status_name || "",
  "Reason": d.status === "failed" ? (d.reason || "") : "",
  "Delivered / done": fmt(d.done_at),
  "Updated by": DELIVERY_SOURCES[d.source] || d.source || "",
  "Reply": d.reply_text || "",
  "Message ID": d.message_id || "",
}));

// The NextSMS account log (GET /api/v2/logs) → rows for the table (newest first, as sent)
export const parseProviderLogs = (text) => {
  let data;
  try { data = typeof text === "string" ? parseProviderJson(text) : text; } catch { return []; }
  return (Array.isArray(data?.results) ? data.results : []).map(r => {
    const state = deliveryStateOf(r.status?.id, r.status?.groupId);
    return {
      messageId: r.messageId != null ? String(r.messageId) : "",
      to: r.to ? String(r.to) : "", from: r.from ? String(r.from) : "",
      channel: r.channel ? String(r.channel) : "", reference: r.reference ? String(r.reference) : "",
      sentAt: eatToIso(r.sentAt), doneAt: eatToIso(r.doneAt),
      state: state || (r.delivery ? null : "sent"), statusName: r.status?.name ? String(r.status.name) : (r.delivery || ""),
      reason: state === "failed" ? statusReason(r.status?.id, r.status?.name) : "",
      smsCount: Number(r.smsCount) || 0, text: r.text ? String(r.text) : "",
    };
  });
};

// Query for the account log: dates YYYY-MM-DD (East Africa days), optional channel / phone, paging
export const providerLogsQuery = ({ since, until, channel = "all", to = "", offset = 0, limit = 200 } = {}) => {
  const p = new URLSearchParams();
  if (since) p.set("sentSince", since);
  if (until) p.set("sentUntil", until);
  if (channel && channel !== "all") p.set("channel", channel);
  const digits = String(to || "").replace(/\D/g, "");
  if (digits) p.set("to", digits.startsWith("0") ? `255${digits.slice(1)}` : digits);
  p.set("limit", String(Math.min(Math.max(Number(limit) || 200, 1), 200)));
  if (offset) p.set("offset", String(offset));
  return `?${p.toString()}`;
};

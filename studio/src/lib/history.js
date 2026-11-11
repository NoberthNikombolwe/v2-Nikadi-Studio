import { normalisePhone } from "./phone.js";

// Event history: an append-only log (event_logs table) of what happened to an event —
// every WhatsApp card / SMS sent and its result, card uploads, late delivery reports,
// bulk-send summaries and changes to the event or its contact list.

export const HISTORY_CHANNELS = {
  whatsapp: { label: "WhatsApp", icon: "whatsapp" },
  sms:      { label: "SMS",      icon: "sms" },
  card:     { label: "Card",     icon: "image" },
  event:    { label: "Event",    icon: "folder" },
  finance:  { label: "Finance",  icon: "wallet" },
  calls:    { label: "Calls",    icon: "phone" },
};

export const HISTORY_ACTIONS = {
  send: "Sent", status: "Delivery report", upload: "Card upload", bulk: "Bulk send",
  create: "Event created", update: "Event updated", contacts: "Contacts changed",
  call: "Guest call", team: "Team changed", income: "Income recorded", txn_edit: "Transaction edited", expense: "Expense recorded", remove: "Transaction removed",
  schedule: "Schedule changed", reply: "Guest reply", guest_delete: "Guest card deleted",
};

// Display order + tone (UI maps tone → colour) for each status
export const HISTORY_STATUSES = {
  read:      { label: "Read",      tone: "good" },
  delivered: { label: "Delivered", tone: "good" },
  sent:      { label: "Sent",      tone: "good" },
  ok:        { label: "OK",        tone: "info" },
  invalid:   { label: "Invalid",   tone: "warn" },
  not_sent:  { label: "Not sent",  tone: "bad"  },
  failed:    { label: "Failed",    tone: "bad"  },
  picked:    { label: "Picked up", tone: "info" },
  busy:      { label: "Busy",      tone: "warn" },
  yes:       { label: "Coming",    tone: "good" },
  no:        { label: "Not coming", tone: "bad" },
};

const clip = (v, max) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, max));

// Builds one event_logs row. Unknown channel/action/status values are rejected so a typo
// can't silently write junk; long text is clipped. user_email/created_at are set by the DB.
export const buildLogRow = (eventId, { channel, action, status = "ok", name, phone, title, detail } = {}) => {
  if (!eventId) throw new Error("buildLogRow: eventId required");
  if (!HISTORY_CHANNELS[channel]) throw new Error(`buildLogRow: unknown channel "${channel}"`);
  if (!HISTORY_ACTIONS[action])   throw new Error(`buildLogRow: unknown action "${action}"`);
  if (!HISTORY_STATUSES[status])  throw new Error(`buildLogRow: unknown status "${status}"`);
  const p = phone ? normalisePhone(phone) : "";
  return {
    event_id:        eventId,
    channel, action, status,
    recipient_name:  clip(name, 200),
    recipient_phone: p || null,
    message_title:   clip(title, 120),
    detail:          clip(detail, 500),
  };
};

// Filters loaded history rows by channel / status ("all" = any) and a free-text search
// over recipient, phone, message, user and detail
export const filterHistory = (rows, { channel = "all", status = "all", q = "" } = {}) => {
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  return rows.filter(r => {
    if (channel !== "all" && r.channel !== channel) return false;
    if (status  !== "all" && r.status  !== status)  return false;
    if (!needle) return true;
    const hay = [r.recipient_name, r.message_title, r.user_email, r.detail].filter(Boolean).join(" ").toLowerCase();
    if (hay.includes(needle)) return true;
    // "0712 345 678" should match the stored 255712345678
    return digits.length >= 4 && !!r.recipient_phone && (r.recipient_phone.includes(digits) || r.recipient_phone.includes(normalisePhone(digits)));
  });
};

// Headline numbers for the History tab. Counts individual sends only (bulk summary rows
// and event changes are excluded), so "cards sent" = WhatsApp sends that went through and
// weren't later reported undeliverable. Delivery reports (action "status") add the
// delivered / read counts, and a failure reported later moves a send from sent to failed.
export const summariseHistory = (rows) => {
  const s = { cardsSent: 0, waProblems: 0, waDelivered: 0, waRead: 0, smsSent: 0, smsFailed: 0, smsDelivered: 0, uploads: 0, lastAt: null };
  for (const r of rows) {
    if (!s.lastAt || r.created_at > s.lastAt) s.lastAt = r.created_at;
    const ok = r.status === "sent" || r.status === "delivered" || r.status === "read";
    if (r.channel === "whatsapp" && r.action === "send")   ok ? s.cardsSent++ : s.waProblems++;
    if (r.channel === "whatsapp" && r.action === "status") {
      if (r.status === "delivered") s.waDelivered++;
      else if (r.status === "read") s.waRead++;
      // A late failure report overrides that card's earlier "sent"
      else if (!ok) { s.waProblems++; s.cardsSent = Math.max(0, s.cardsSent - 1); }
    }
    if (r.channel === "sms" && r.action === "send")        ok ? s.smsSent++   : s.smsFailed++;
    if (r.channel === "sms" && r.action === "status") {
      if (r.status === "delivered") s.smsDelivered++;
      else if (r.status === "failed") { s.smsFailed++; s.smsSent = Math.max(0, s.smsSent - 1); }
    }
    if (r.channel === "card" && r.action === "upload" && r.status === "ok") s.uploads++;
  }
  return s;
};

// Rows for the Excel export, with readable labels and local time
export const historyExportRows = (rows) => rows.map(r => ({
  "Time":      r.created_at ? new Date(r.created_at).toLocaleString("en-GB") : "",
  "Channel":   HISTORY_CHANNELS[r.channel]?.label || r.channel || "",
  "Action":    HISTORY_ACTIONS[r.action] || r.action || "",
  "Status":    HISTORY_STATUSES[r.status]?.label || r.status || "",
  "Recipient": r.recipient_name || "",
  "Phone":     r.recipient_phone ? `+${r.recipient_phone}` : "",
  "Message":   r.message_title || "",
  "By":        r.user_email || "",
  "Detail":    r.detail || "",
}));

// Combines two lists of history rows without duplicates (same id), newest first. Used when
// freshly written entries arrive while a page of history is being loaded.
export const mergeHistory = (a = [], b = []) => {
  const byId = new Map();
  [...a, ...b].forEach(r => byId.set(r.id, r));
  return [...byId.values()].sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || "")));
};

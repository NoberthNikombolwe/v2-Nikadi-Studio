// Send logic shared by the browser and the Edge Functions.
//
// The browser imports it through src/lib (phone.js, messages.js and schedule.js re-export
// it); the run-schedules Edge Function imports it directly. It is plain JavaScript with no
// browser, Node or Deno APIs (no fetch, no env, no clock), so Vite, node:test and Deno can
// all load it — keep it that way. It lives under supabase/functions/_shared because that is
// the folder the Supabase CLI always bundles with a function.

/* ── Phone numbers ── */

// Strips non-digits and rewrites local Tanzanian formats to the 255 country code:
//   0712345678 / 00255712345678 / +255712345678 / 712345678 → 255712345678
// The bare 9-digit form matters because Excel stores 0712345678 as the number
// 712345678 and silently drops the leading zero.
export const normalisePhone = (raw = "") => {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);                       // 00255… international prefix
  if (d.startsWith("0") && d.length >= 9) d = "255" + d.slice(1); // 0712… local format
  else if (d.length === 9 && /^[67]/.test(d)) d = "255" + d;     // 712… (leading 0 lost)
  return d;
};

// True when the normalised number is plausible E.164 (11–15 digits). Used to skip
// obviously bad rows in bulk sends instead of burning an API call (and credit) on them.
export const isValidPhone = (raw) => /^\d{11,15}$/.test(normalisePhone(raw));

/* ── Message text ── */

// Fills {name} / {cardType} / {phone} and any other {Column} from a recipient. Every
// occurrence is replaced; an unknown {x} is left as typed so the user can spot it.
export const fillTemplate = (template = "", rec = {}) => String(template).replace(/\{(\w+)\}/g, (_, key) => {
  if (key === "name")     return rec.name     || "";
  if (key === "cardType") return rec.cardType || "";
  if (key === "phone")    return rec.phone ? `+${normalisePhone(rec.phone)}` : "";
  return rec[key] !== undefined && rec[key] !== null ? String(rec[key]) : `{${key}}`;
});

// The {placeholders} a message uses, in order of first use
export const placeholdersIn = (text = "") => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]))];

// Placeholders the server can fill on its own: only these are stored on event_cards
export const CARD_PLACEHOLDERS = ["name", "cardType", "phone"];

/* ── SMS provider results ── */

// messaging-service.co.tz SMS status groups: 18 = accepted (sent), 20 = delivered.
// Anything else (or no result) counts as failed.
export const smsStatusFromGroup = (groupId) => groupId === 20 ? "delivered" : groupId === 18 ? "sent" : "failed";

// Matches a /text/multi response back to the numbers that were sent, in order. The
// provider echoes each recipient's number; when a number was sent more than once its
// results are handed out in order, one per recipient. Returns one groupId per phone
// (undefined when the provider reported nothing for it).
export const matchSmsResults = (phones = [], respMessages = []) => {
  const queues = new Map();
  (Array.isArray(respMessages) ? respMessages : []).forEach(m => {
    const k = String(m?.to);
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(m);
  });
  return phones.map(p => queues.get(normalisePhone(p))?.shift()?.status?.groupId);
};

/* ── WhatsApp provider results ── */

const WA_SENT_IDS    = [73, 109, 77];          // DELIVERED_TO_HANDSET / SENT_TO_OPERATOR / DELIVERED_TO_OPERATOR
const WA_INVALID_IDS = [75, 76, 78, 79, 80];   // UNDELIVERABLE …

// True when the provider's text says the number isn't on WhatsApp
export const waInvalidHint = (t = "") => {
  const s = String(t || "").toLowerCase();
  return s.includes("not a whatsapp") || s.includes("not registered")
    || s.includes("unregistered") || s.includes("no whatsapp")
    || s.includes("missing outlet") || s.includes("recipient not found");
};

// Reads the provider's answer to POST /api/whatsapp/v2/text/single (HTTP status + raw body).
// → { status: "sent" | "invalid" | "not_sent", pending, messageId, detail }
//   groupId 18 = accepted but still pending (counts as sent; a late report may reject it),
//   20 + 73/109/77 = sent, 20 + 75–80 / 19 + 111 / "not registered" text = not on WhatsApp.
export const classifyWaSend = (httpStatus, rawText = "") => {
  if (!(httpStatus >= 200 && httpStatus < 300)) {
    if ((httpStatus === 422 || httpStatus === 400) && waInvalidHint(rawText)) {
      return { status: "invalid", pending: false, messageId: null, detail: "number not on WhatsApp" };
    }
    return { status: "not_sent", pending: false, messageId: null, detail: `HTTP ${httpStatus}: ${rawText}` };
  }
  let data;
  try { data = JSON.parse(rawText); } catch { return { status: "not_sent", pending: false, messageId: null, detail: "Invalid JSON response" }; }
  const msg   = data?.messages?.[0];
  const grp   = msg?.status?.groupId;
  const id    = msg?.status?.id;
  const sName = msg?.status?.name || "";
  const sDesc = msg?.status?.description || "";
  const messageId = msg?.messageId ?? null;
  if (grp === 18) return { status: "sent", pending: true, messageId, detail: null };
  if (grp === 20 && WA_SENT_IDS.includes(id)) return { status: "sent", pending: false, messageId, detail: null };
  if ((grp === 20 && WA_INVALID_IDS.includes(id)) || (grp === 19 && id === 111) || waInvalidHint(sName) || waInvalidHint(sDesc)) {
    return { status: "invalid", pending: false, messageId, detail: "number not on WhatsApp" };
  }
  return { status: "not_sent", pending: false, messageId, detail: sName || `groupId ${grp}` };
};

/* ── Who a scheduled send goes to ── */

// Audience of a scheduled send:
//   all          every guest with a valid number
//   not_sent     guests not yet sent this (main SMS / WhatsApp card status) — main SMS and card sends only
//   confirmed    guests who said Yes on the Calls tab
//   not_declined everyone except guests who said No
export const SCHEDULE_AUDIENCES = ["all", "not_sent", "confirmed", "not_declined"];

// Picks the guests one scheduled send goes to, from event_cards rows
// (id, name, card_type, phone, wa_status, sms_status, call_status, card_url).
//   channel "sms":      each guest gets `body` filled in; a number already given the same
//                       text in this send is a duplicate
//   channel "whatsapp": `image` = the template has an image header, so each guest needs an
//                       uploaded card (card_url); duplicates are the same number + same card
//                       (or just the same number for a text-only template)
// Returns { targets: [{ id, name, cardType, phone (normalised), text?, cardUrl? }],
//           skipped: { audience, noPhone, invalid, noCard, duplicate } }
export const scheduleTargets = (cards = [], { channel = "sms", audience = "all", image = false, body = "" } = {}) => {
  const skipped = { audience: 0, noPhone: 0, invalid: 0, noCard: 0, duplicate: 0 };
  const targets = [];
  const seen = new Set();
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || typeof c !== "object") continue;
    if (audience === "confirmed"    && c.call_status !== "yes") { skipped.audience++; continue; }
    if (audience === "not_declined" && c.call_status === "no")  { skipped.audience++; continue; }
    if (audience === "not_sent") {
      const done = channel === "sms" ? (c.sms_status === "sent" || c.sms_status === "delivered") : c.wa_status === "sent";
      if (done) { skipped.audience++; continue; }
    }
    if (!String(c.phone ?? "").trim()) { skipped.noPhone++; continue; }
    if (!isValidPhone(c.phone))        { skipped.invalid++; continue; }
    const phone = normalisePhone(c.phone);
    const base = { id: c.id ?? null, name: c.name || "", cardType: c.card_type || "", phone };
    let key, target;
    if (channel === "sms") {
      const text = fillTemplate(body, { name: base.name, cardType: base.cardType, phone });
      key = `${phone}|${text}`;
      target = { ...base, text };
    } else {
      if (image && !c.card_url) { skipped.noCard++; continue; }
      key = image ? `${phone}|${c.card_url}` : phone;
      target = image ? { ...base, cardUrl: c.card_url } : base;
    }
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    targets.push(target);
  }
  return { targets, skipped };
};

// "12 skipped: 5 no phone, 7 no card" style summary of scheduleTargets().skipped ("" if none)
export const describeTargetSkips = (skipped = {}) => {
  const parts = [
    [skipped.audience,  "not in this audience"],
    [skipped.noPhone,   "no phone"],
    [skipped.invalid,   "invalid number"],
    [skipped.noCard,    "no card uploaded"],
    [skipped.duplicate, "duplicate"],
  ].filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  const total = Object.values(skipped).reduce((s, n) => s + (Number(n) || 0), 0);
  return total ? `${total} skipped: ${parts.join(", ")}` : "";
};

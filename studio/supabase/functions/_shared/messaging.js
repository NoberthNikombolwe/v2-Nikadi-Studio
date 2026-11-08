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

/* ── Provider status codes (NextSMS API docs → "Statuses") ── */

// Every status id the provider uses: its group, name, what it means for a guest's message
// and the reason in plain words. Always go by the id, not the name — some names repeat
// (ACCEPTED is both 52 and 77). state:
//   "sent"      still on its way, no final result yet
//   "delivered" on the phone          "read"   opened on WhatsApp
//   "failed"    final — not delivered (the meaning says why)
// supabase-roles-settings-scan.sql delivery_state() mirrors the state column; a test compares them.
const S = (group, name, state, meaning) => ({ group, name, state, meaning });
export const PROVIDER_STATUS = {
  50:  S(18, "PENDING_WAITING_DELIVERY", "sent", "Waiting for the mobile network to deliver it"),
  51:  S(18, "ENROUTE", "sent", "Sent, waiting for the delivery report"),
  52:  S(18, "ACCEPTED", "sent", "Accepted, waiting for its send time"),
  88:  S(18, "DISPATCHED", "sent", "Handed to the mobile network"),
  112: S(18, "DISCARDED", "failed", "Dropped by the network — send it again later"),
  73:  S(20, "DELIVERED", "delivered", "Delivered to the phone"),
  74:  S(20, "EXPIRED", "failed", "Not delivered in time — the phone may be off or out of coverage"),
  75:  S(20, "DELETED", "failed", "Deleted before it was delivered"),
  76:  S(20, "UNDELIVERABLE", "failed", "Cannot be delivered — the number may not exist"),
  77:  S(20, "ACCEPTED", "sent", "Accepted by the network, on its way"),
  78:  S(20, "UNKNOWN", "failed", "The network gave no result"),
  79:  S(20, "REJECTED", "failed", "Refused by the network"),
  80:  S(20, "SKIPPED", "failed", "Skipped because of operator downtime — send it again later"),
  108: S(20, "READ", "read", "Opened on WhatsApp"),
  109: S(20, "SENT", "sent", "Sent to WhatsApp, not yet on the phone"),
  114: S(20, "SPAM_RATE_LIMIT", "failed", "Held back by WhatsApp (sending limit)"),
  120: S(20, "FAILED", "failed", "WhatsApp could not deliver it — check the number uses WhatsApp"),
  57:  S(22, "FAILED_NOT_ENOUGH_CREDITS", "failed", "Not enough SMS credit"),
  58:  S(22, "FAILED_SENDER", "failed", "Sender ID not registered on that network"),
  53:  S(19, "REJECTED_NETWORK", "failed", "Network not supported"),
  54:  S(19, "REJECTED_PREFIX_MISSING", "failed", "Number has no country code"),
  55:  S(19, "REJECTED_DND", "failed", "The number blocks promotional messages (DND)"),
  56:  S(19, "REJECTED_SOURCE", "failed", "Sender ID not approved"),
  59:  S(19, "REJECTED_DESTINATION", "failed", "Number blocked or unsubscribed"),
  60:  S(19, "REJECTED_PREPAID_PACKAGE_EXPIRED", "failed", "SMS package expired"),
  61:  S(19, "REJECTED_DESTINATION_NOT_REGISTERED", "failed", "Test account: this number is not registered"),
  62:  S(19, "REJECTED_ROUTE_NOT_AVAILABLE", "failed", "No route to this network"),
  63:  S(19, "REJECTED_FLOODING_FILTER", "failed", "Too many messages to this number in an hour"),
  64:  S(19, "REJECTED_SYSTEM_ERROR", "failed", "Provider system error"),
  65:  S(19, "REJECTED_DUPLICATE_MESSAGE_ID", "failed", "Duplicate message"),
  66:  S(19, "REJECTED_INVALID_UDH", "failed", "Invalid message format"),
  67:  S(19, "REJECTED_MESSAGE_TOO_LONG", "failed", "Message too long"),
  68:  S(19, "MISSING_TO", "failed", "No number given"),
  69:  S(19, "REJECTED_INVALID_DESTINATION", "failed", "Invalid number"),
  107: S(19, "REJECTED_PRICE_NOT_DEFINED", "failed", "No price set for this network"),
  110: S(19, "REJECTED_EXCEEDED_MESSAGE_LIMIT", "failed", "Message limit reached"),
  111: S(19, "REJECTED_MISSING_OUTLET", "failed", "No active WhatsApp account or route for this send"),
};
// Ids that mean "this number is not on WhatsApp" for a WhatsApp send
export const WA_NOT_ON_WHATSAPP = [76, 111, 120];

const toInt = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

// The state of a status: by id, else by group (18 = still on its way, 19 / 22 = failed);
// null when it can't be told (an unknown id in group 20)
export const deliveryStateOf = (id, groupId) => {
  const s = PROVIDER_STATUS[toInt(id)];
  if (s) return s.state;
  const g = toInt(groupId);
  return g === 18 ? "sent" : g === 19 || g === 22 ? "failed" : null;
};

// "UNDELIVERABLE — Cannot be delivered — the number may not exist" ("" when nothing is known)
export const statusReason = (id, name) => {
  const s = PROVIDER_STATUS[toInt(id)];
  return [s?.name || (name ? String(name) : ""), s?.meaning || ""].filter(Boolean).join(" — ");
};

// Parses a provider answer keeping every messageId / sendReference exact. They are numbers of
// ~19 digits, which JSON.parse would round (7391827364512378881 → 7391827364512379000), so
// they would never match the delivery reports, which give them as text.
export const parseProviderJson = (text) =>
  JSON.parse(String(text ?? "").replace(/("(?:messageId|sendReference)"\s*:\s*)(-?\d+(?:\.\d+)?)/g, "$1\"$2\""));

// A refused request in words, keeping what the provider said — e.g.
// "HTTP 422: Duplicate request sent within past 24 hour(s)" (its JSON `message`, else the
// start of the text). A bare "HTTP 422" hides why.
export const providerErrorText = (httpStatus, rawText = "") => {
  let msg = "";
  try { const j = JSON.parse(String(rawText)); msg = j?.message || j?.error || ""; } catch { msg = String(rawText || ""); }
  msg = String(msg).replace(/\s+/g, " ").trim().slice(0, 160);
  return `HTTP ${httpStatus}${msg ? `: ${msg}` : ""}`;
};

/* ── SMS provider results ── */

// One SMS send result (a messages[] entry of /text/single or /text/multi):
// → { status: "sent" | "delivered" | "failed", missing, messageId (text), statusId, groupId, statusName, reason }
// The normal answer is "sent" (group 18, e.g. 51 ENROUTE): the delivery report tells the rest.
// `missing` = the provider said nothing about this number.
export const smsSendResult = (msg) => {
  if (!msg || typeof msg !== "object") {
    return { status: "failed", missing: true, messageId: null, statusId: null, groupId: null, statusName: null, reason: "No result from the SMS provider" };
  }
  const st = msg.status || {};
  const state = deliveryStateOf(st.id, st.groupId);
  const status = state === "delivered" || state === "read" ? "delivered" : state === "sent" ? "sent" : "failed";
  return {
    status, missing: false,
    messageId: msg.messageId !== undefined && msg.messageId !== null && msg.messageId !== "" ? String(msg.messageId) : null,
    statusId: toInt(st.id), groupId: toInt(st.groupId), statusName: st.name ? String(st.name) : null,
    reason: status === "failed" ? (statusReason(st.id, st.name) || "Not accepted by the SMS provider") : null,
  };
};

// Old helper kept for callers that only need the word: sent / delivered / failed
export const smsStatusFromGroup = (groupId, id) => smsSendResult({ status: { groupId, id } }).status;

// Matches a /text/multi response back to the numbers that were sent, in order. The provider
// echoes each recipient's number; a number sent more than once gets its results in order,
// one per recipient. → one messages[] entry per phone (undefined when nothing came back).
export const matchSmsMessages = (phones = [], respMessages = []) => {
  const queues = new Map();
  (Array.isArray(respMessages) ? respMessages : []).forEach(m => {
    const k = normalisePhone(String(m?.to ?? ""));
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(m);
  });
  return phones.map(p => queues.get(normalisePhone(p))?.shift());
};
// The groupId of each matched message (kept for older callers)
export const matchSmsResults = (phones = [], respMessages = []) => matchSmsMessages(phones, respMessages).map(m => m?.status?.groupId);

// NextSMS's duplicate protection (/text/multi only): a request whose FIRST message is exactly the
// first message of a request from the last 24 hours is refused with "Duplicate request sent
// within past 24 hour(s)". Nothing in that request was sent.
export const isDuplicateRefusal = (httpStatus, rawText = "") =>
  !(httpStatus >= 200 && httpStatus < 300) && /duplicate request/i.test(String(rawText ?? ""));

// Sends SMS ({ from, to, text }) in one /text/multi request, working round the duplicate
// protection: when NextSMS refuses the request as a duplicate, its first message goes alone
// through /text/single (which has no such rule) and the rest are sent again, now led by another
// message. Used by Send All, the scheduler and schedules handed to NextSMS.
//   post(path, body) → Promise<{ status, text }>, path "/text/multi" or "/text/single"
//   extra: fields added to every request (date, time, reference for a send held by NextSMS)
// → { answers: one messages[] entry per message (undefined = NextSMS said nothing about it),
//     problem: why the messages from `problemFrom` on got no answer ("" = they all did),
//     problemFrom, refused: true when NextSMS refused them, so they were NOT sent (false =
//     no answer at all, e.g. a timeout — they may have been sent) }
export const sendSmsMessages = async (post, messages = [], extra = {}) => {
  const answers = messages.map(() => undefined);
  const stop = (from, problem, refused) => ({ answers, problem, problemFrom: from, refused });
  const ok = (s) => s >= 200 && s < 300;
  let i = 0;
  while (i < messages.length) {
    const rest = messages.slice(i);
    let r;
    try { r = await post("/text/multi", { messages: rest, flash: 0, ...extra }); }
    catch (e) { return stop(i, String(e?.message || e), false); }
    if (isDuplicateRefusal(r.status, r.text)) {
      const m = rest[0];
      let one;
      try { one = await post("/text/single", { from: m.from, to: m.to, text: m.text, flash: 0, ...extra }); }
      catch (e) { return stop(i, String(e?.message || e), false); }
      if (!ok(one.status)) return stop(i, providerErrorText(one.status, one.text), true);
      try { answers[i] = parseProviderJson(one.text)?.messages?.[0]; } catch { /* no readable answer for it */ }
      i++;
      continue;
    }
    if (!ok(r.status)) return stop(i, providerErrorText(r.status, r.text), true);
    let data = null;
    try { data = parseProviderJson(r.text); } catch { data = null; }
    matchSmsMessages(rest.map(m => m.to), data?.messages || []).forEach((a, k) => { answers[i + k] = a; });
    break;
  }
  return stop(messages.length, "", false);
};

/* ── WhatsApp provider results ── */

// True when the provider's text says the number isn't on WhatsApp
export const waInvalidHint = (t = "") => {
  const s = String(t || "").toLowerCase();
  return s.includes("not a whatsapp") || s.includes("not registered")
    || s.includes("unregistered") || s.includes("no whatsapp")
    || s.includes("missing outlet") || s.includes("recipient not found");
};

// Reads the provider's answer to POST /api/whatsapp/v2/text/single (HTTP status + raw body).
// → { status: "sent" | "delivered" | "read" | "invalid" | "not_sent", pending, messageId,
//     statusId, groupId, statusName, detail }
// "sent" + pending: accepted, the delivery report (webhook / check) tells the rest.
// "invalid": the number isn't on WhatsApp (76 / 111 / 120, or the provider says so).
export const classifyWaSend = (httpStatus, rawText = "") => {
  const none = { messageId: null, statusId: null, groupId: null, statusName: null };
  if (!(httpStatus >= 200 && httpStatus < 300)) {
    if ((httpStatus === 422 || httpStatus === 400) && waInvalidHint(rawText)) {
      return { ...none, status: "invalid", pending: false, detail: "number not on WhatsApp" };
    }
    return { ...none, status: "not_sent", pending: false, detail: `HTTP ${httpStatus}: ${rawText}` };
  }
  let data;
  try { data = parseProviderJson(rawText); } catch { return { ...none, status: "not_sent", pending: false, detail: "Invalid JSON response" }; }
  const msg   = data?.messages?.[0];
  const st    = msg?.status || {};
  const grp   = toInt(st.groupId);
  const id    = toInt(st.id);
  const sName = st.name || "";
  const base  = { messageId: msg?.messageId != null && msg.messageId !== "" ? String(msg.messageId) : null, statusId: id, groupId: grp, statusName: sName || null };
  const state = deliveryStateOf(id, grp);
  if (state === "read") return { ...base, status: "read", pending: false, detail: null };
  if (state === "delivered") return { ...base, status: "delivered", pending: false, detail: null };
  if (state === "sent") return { ...base, status: "sent", pending: true, detail: null };
  if (WA_NOT_ON_WHATSAPP.includes(id) || waInvalidHint(sName) || waInvalidHint(st.description)) {
    return { ...base, status: "invalid", pending: false, detail: "number not on WhatsApp" };
  }
  return { ...base, status: "not_sent", pending: false, detail: (state === "failed" && statusReason(id, sName)) || sName || `groupId ${grp}` };
};

// A WhatsApp guest's card status (event_cards.wa_status) for a delivery state
export const waCardStatus = (state, statusId) =>
  state === "read" ? "read" : state === "delivered" ? "delivered" : state === "sent" ? "sent"
    : WA_NOT_ON_WHATSAPP.includes(toInt(statusId)) ? "invalid" : "notSent";

// The History status (event_logs.status) for a delivery state
export const historyStatusOf = (channel, state, statusId) => channel === "whatsapp"
  ? ({ read: "read", delivered: "delivered", sent: "sent" })[state] || (WA_NOT_ON_WHATSAPP.includes(toInt(statusId)) ? "invalid" : "not_sent")
  : ({ delivered: "delivered", read: "delivered", sent: "sent" })[state] || "failed";

/* ── Delivery reports and the delivery webhook ── */

// "2026-10-20 10:15:07" (East Africa Time, as the provider writes it) → ISO time, or null
export const eatToIso = (t) => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(String(t || "").trim());
  return m ? `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+03:00` : null;
};

// GET /api/v2/reports answer → [{ message_id, status_id, group_id, status_name, done_at }]
// (rows without a messageId or any status are dropped). Accepts the raw text or parsed JSON.
export const parseDeliveryReports = (data) => {
  let obj = data;
  if (typeof data === "string") { try { obj = parseProviderJson(data); } catch { return []; } }
  return (Array.isArray(obj?.results) ? obj.results : [])
    .filter(r => r && r.messageId !== undefined && r.messageId !== null && r.messageId !== "")
    .map(r => ({
      message_id: String(r.messageId),
      status_id: toInt(r.status?.id),
      group_id: toInt(r.status?.groupId),
      status_name: r.status?.name ? String(r.status.name) : (r.delivery ? String(r.delivery) : null),
      done_at: eatToIso(r.doneAt),
    }))
    .filter(r => r.status_id !== null || r.group_id !== null);
};

// One delivery webhook call (the account's Delivery Callback URL) →
//   { kind: "status", message_id, status_id, status_name }   a delivery result
//   { kind: "reply",  message_id, text }                     a WhatsApp button reply
//   { kind: "ping" }                                         no messageId (e.g. the dashboard's test)
export const parseDeliveryCallback = (body) => {
  if (!body || typeof body !== "object" || body.messageId === undefined || body.messageId === null || body.messageId === "") return { kind: "ping" };
  const message_id = String(body.messageId);
  if (body.response !== undefined || body.payload !== undefined || (body.text !== undefined && body.id === undefined && body.status === undefined)) {
    return { kind: "reply", message_id, text: String(body.response ?? body.text ?? body.payload ?? "").slice(0, 500) };
  }
  return { kind: "status", message_id, status_id: toInt(body.id), status_name: body.status ? String(body.status) : null };
};

// Query strings for GET /api/v2/reports: up to 50 messageIds each (messageId is repeated —
// looking reports up by id never "uses them up", unlike a call without messageId)
export const reportsQueries = (ids = [], channel = "sms", perCall = 50) => {
  const uniq = [...new Set((ids || []).map(v => String(v ?? "")).filter(Boolean))];
  const out = [];
  for (let i = 0; i < uniq.length; i += perCall) {
    out.push(`?channel=${encodeURIComponent(channel)}&size=200&` + uniq.slice(i, i + perCall).map(id => `messageId=${encodeURIComponent(id)}`).join("&"));
  }
  return out;
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
      const done = channel === "sms" ? (c.sms_status === "sent" || c.sms_status === "delivered")
        : (c.wa_status === "sent" || c.wa_status === "delivered" || c.wa_status === "read");
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

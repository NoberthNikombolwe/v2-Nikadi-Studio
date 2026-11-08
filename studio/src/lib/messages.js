import { normalisePhone } from "./phone.js";
import { fillTemplate, smsStatusFromGroup, matchSmsResults, classifyWaSend, smsSendResult, matchSmsMessages, parseProviderJson,
  waCardStatus, parseDeliveryReports, reportsQueries, statusReason, providerErrorText, sendSmsMessages, isDuplicateRefusal } from "../../supabase/functions/_shared/messaging.js";

// Helpers for an event's SMS messages. An event has its main message (events.sms_message,
// statuses in event_cards.sms_status) plus any number of extra messages stored as JSON in
// events.sms_messages. Each extra message picks its own recipients:
//   source "contacts" → the event's contacts; per-message statuses live in `statuses`,
//                        keyed by recipientKey() so they survive re-importing the list
//   source "upload"   → its own uploaded list (`recipients`, each with a `smsStatus`) whose
//                        columns become {placeholders} for that message

// Fills {name} / {cardType} / {phone} and any other {Column} from a recipient. Shared with
// the run-schedules Edge Function, so it lives in supabase/functions/_shared/messaging.js.
// The provider-result readers (SMS groupIds, the multi-send matcher, the WhatsApp send
// classifier) live there too, so a scheduled send reads results exactly like a click does.
export { fillTemplate, smsStatusFromGroup, matchSmsResults, classifyWaSend, smsSendResult, matchSmsMessages, parseProviderJson,
  waCardStatus, parseDeliveryReports, reportsQueries, statusReason, providerErrorText, sendSmsMessages, isDuplicateRefusal };

// Turns spreadsheet rows (SheetJS sheet_to_json output) into recipients. Header variants
// map to the standard keys name / cardType / phone (case, spaces and _ ignored); every
// other column passes through under its original header. `columns` is the ordered list
// offered as {placeholders}: name and cardType (when present) first, then the extras.
export const normaliseSheetRows = (data = []) => {
  const found = new Set();
  const extraCols = [];
  const rows = data.map(row => {
    const n = {};
    Object.keys(row).forEach(k => {
      const kl = k.trim().toLowerCase().replace(/[\s_]/g, "");
      if      (kl === "name")                                         { n.name     = String(row[k]); found.add("name"); }
      else if (kl === "cardtype" || kl === "card")                    { n.cardType = String(row[k]); found.add("cardType"); }
      else if (kl === "phone" || kl === "phonenumber" || kl === "mobile") { n.phone = String(row[k]); found.add("phone"); }
      else { n[k] = String(row[k]); if (!extraCols.includes(k)) extraCols.push(k); }
    });
    return n;
  });
  const columns = [...["name", "cardType"].filter(c => found.has(c)), ...extraCols];
  return { rows, columns };
};

// Identifies one recipient for per-message statuses: normalised phone + name, so two
// contacts sharing a number still get separate statuses
export const recipientKey = (rec = {}) => `${normalisePhone(rec.phone || "")}|${String(rec.name || "").trim().toLowerCase()}`;

// Returns `msg` with new statuses applied. `updates` maps a recipient's index in `recs`
// (the list the send was made from) to its new status.
export const applyMessageStatuses = (msg, recs, updates) => {
  if (msg.source === "upload") {
    return { ...msg, recipients: msg.recipients.map((r, i) => updates.has(i) ? { ...r, smsStatus: updates.get(i) } : r) };
  }
  const statuses = { ...msg.statuses };
  updates.forEach((status, i) => { if (recs[i]) statuses[recipientKey(recs[i])] = status; });
  return { ...msg, statuses };
};

// Cleans the extra messages loaded from events.sms_messages so a missing column, a null
// or a hand-edited row can't crash the SMS tab
export const sanitiseMessages = (raw) => (Array.isArray(raw) ? raw : [])
  .filter(m => m && typeof m === "object" && m.id)
  .map((m, i) => ({
    id:         String(m.id),
    title:      typeof m.title === "string" && m.title.trim() ? m.title : `Message ${i + 2}`,
    body:       typeof m.body === "string" ? m.body : "",
    source:     m.source === "upload" ? "upload" : "contacts",
    fileName:   typeof m.fileName === "string" ? m.fileName : null,
    columns:    Array.isArray(m.columns) ? m.columns.map(String) : [],
    recipients: Array.isArray(m.recipients) ? m.recipients.filter(r => r && typeof r === "object") : [],
    statuses:   m.statuses && typeof m.statuses === "object" && !Array.isArray(m.statuses) ? m.statuses : {},
  }));

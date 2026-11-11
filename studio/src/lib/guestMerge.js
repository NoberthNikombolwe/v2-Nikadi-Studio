// Saving a guest list onto an event's existing event_cards rows without losing the
// "ledger": phone-call answers/comments and door check-ins are history and must never
// be reset or deleted because a spreadsheet was uploaded again.
//
// planCardSave(entries, oldRows) decides, for each record in the new list:
//   keep  — it is an existing row: update it in place (same id, so printed QR codes,
//           calls and scans stay attached). Matched by dbId, else by phone + name,
//           else by phone alone (one candidate), else by name alone (no phone on either).
//   fresh — a new guest: insert.
// and, for old rows not in the new list:
//   retained — rows with call or scan data: never deleted (re-added to the list)
//   remove   — rows with no ledger data: safe to delete
import { normalisePhone } from "./phone.js";

const nameKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const phoneKey = (s) => (s ? normalisePhone(String(s)) : "");

// A new spreadsheet starts the sends over: every guest's WhatsApp card status and main SMS
// status go back to "not sent" (`idle` / `pending`, the WA / SMS constants in App.jsx).
// Nothing else changes — calls, check-ins, extra messages and card images are kept.
export const resetSendStatuses = (rows = [], idle = "idle", pending = "pending") =>
  rows.map(r => ({ ...r, waStatus: idle, smsStatus: pending }));

// Does this event_cards row carry call or check-in history?
export const hasLedger = (row = {}) =>
  !!(row.call_status || (row.call_comment && String(row.call_comment).trim()) || Number(row.scan_count) > 0);

// entries: [{ r, i }] — r is a record ({ dbId?, name, phone, ... }), i its index in the list
export const planCardSave = (entries = [], oldRows = []) => {
  const byId = new Map(oldRows.map(o => [o.id, o]));
  const used = new Set();
  const keep = [], fresh = [], pending = [];

  for (const e of entries) {
    if (e.r.dbId && byId.has(e.r.dbId) && !used.has(e.r.dbId)) { used.add(e.r.dbId); keep.push({ ...e, id: e.r.dbId, old: byId.get(e.r.dbId), matched: "id" }); }
    else pending.push(e);
  }
  const free = () => oldRows.filter(o => !used.has(o.id));
  const take = (e, o, how) => { used.add(o.id); keep.push({ ...e, id: o.id, old: o, matched: how }); };

  const rest = [];
  for (const e of pending) {           // 1. phone + name
    const p = phoneKey(e.r.phone), n = nameKey(e.r.name);
    const o = p && free().find(x => phoneKey(x.phone) === p && nameKey(x.name) === n);
    if (o) take(e, o, "phone+name"); else rest.push(e);
  }
  const rest2 = [];
  for (const e of rest) {              // 2. phone alone, only when it is unambiguous
    const p = phoneKey(e.r.phone);
    const c = p ? free().filter(x => phoneKey(x.phone) === p) : [];
    const samePhoneInNew = p ? rest.filter(x => phoneKey(x.r.phone) === p).length : 0;
    if (c.length === 1 && samePhoneInNew === 1) take(e, c[0], "phone"); else rest2.push(e);
  }
  for (const e of rest2) {             // 3. name alone, when neither side has a phone
    const n = nameKey(e.r.name);
    const o = !phoneKey(e.r.phone) && n && free().find(x => !phoneKey(x.phone) && nameKey(x.name) === n);
    if (o) take(e, o, "name"); else fresh.push(e);
  }

  const left = free();
  return { keep, fresh, retained: left.filter(hasLedger), remove: left.filter(o => !hasLedger(o)).map(o => o.id) };
};

// Import guests from a spreadsheet straight into an event (Calls / Scanner tabs). Adds
// only: never changes or removes a saved guest. A row whose name, phone AND card type all
// match a saved guest (or an earlier row in the same file) is skipped and reported; the same
// name and phone with another card type (e.g. a SINGLE and a DOUBLE card) is added.
//   rows:  [{ name, cardType, phone, ... }]   (from normaliseSheetRows)
//   cards: event_cards rows ({ name, phone, card_type })
// → { add: [row], skip: [{ row, reason, existing? }], invalid: [{ row, reason }] }
export const splitImport = (rows = [], cards = []) => {
  const key = (n, p, t) => `${nameKey(n)}|${phoneKey(p)}|${nameKey(t)}`;
  const saved = new Map(cards.map(c => [key(c.name, c.phone, c.card_type), c]));
  const seen = new Set();
  const add = [], skip = [], invalid = [];
  for (const row of rows) {
    if (!nameKey(row.name)) { invalid.push({ row, reason: "No name" }); continue; }
    const k = key(row.name, row.phone, row.cardType);
    if (saved.has(k)) { skip.push({ row, reason: "Already on the guest list", existing: saved.get(k) }); continue; }
    if (seen.has(k)) { skip.push({ row, reason: "Repeated in this file" }); continue; }
    seen.add(k);
    add.push(row);
  }
  return { add, skip, invalid };
};

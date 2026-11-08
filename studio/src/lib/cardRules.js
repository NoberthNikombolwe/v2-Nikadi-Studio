// Card types → how many people a card admits at the door. Mirrors people_for_card_type()
// in supabase-roles-settings-scan.sql: a matching rule (case-insensitive) wins, then a
// plain number ("5" → 5) when numeric types are on, otherwise the default.

export const DEFAULT_CARD_SETTINGS = { numeric_card_types: true, default_people: 1 };

export const peopleForCardType = (type, rules = [], settings = DEFAULT_CARD_SETTINGS) => {
  const t = String(type ?? "").trim().toLowerCase();
  const rule = rules.find(r => String(r.name || "").trim().toLowerCase() === t);
  if (rule) return Math.max(1, Number(rule.people) || 1);
  if ((settings.numeric_card_types ?? true) && /^\d{1,4}$/.test(t)) return Math.max(1, Number(t));
  return Math.max(1, Number(settings.default_people) || 1);
};

// "1 person" / "3 people"
export const peopleLabel = (n) => `${n} ${n === 1 ? "person" : "people"}`;

// Door status of a card from its counts
export const scanStatus = (count = 0, max = 1) => count <= 0 ? "pending" : count >= max ? "complete" : "partial";
export const remaining = (count = 0, max = 1) => Math.max(0, max - count);

// Totals for a list of cards (event_cards rows): cards, people expected, people entered
export const scanTotals = (cards = []) => cards.reduce((t, c) => {
  t.cards++; t.people += Number(c.max_scans) || 1; t.entered += Number(c.scan_count) || 0;
  if ((Number(c.scan_count) || 0) >= (Number(c.max_scans) || 1)) t.complete++;
  return t;
}, { cards: 0, people: 0, entered: 0, complete: 0 });

// Field errors for the card-type rule form
export const validateCardRule = (form = {}, rules = []) => {
  const errors = {};
  const name = String(form.name || "").trim();
  if (!name) errors.name = "Card type name is required";
  else if (rules.some(r => !(form.id && r.id === form.id) && String(r.name).trim().toLowerCase() === name.toLowerCase())) errors.name = "This card type already exists";
  const n = Number(form.people);
  if (!Number.isInteger(n) || n < 1 || n > 1000) errors.people = "People must be a whole number from 1 to 1000";
  return errors;
};

// How a guest's card reached them: "sent" (WhatsApp/SMS sent or delivered) or "uploaded" (on the list only)
export const cardSource = (c = {}) =>
  /^(sent|delivered|read)$/i.test(c.wa_status || "") || /^(sent|delivered)$/i.test(c.sms_status || "") ? "sent" : "uploaded";

// Scanner guest list: filter by text (name / card type / phone) and by scan state
//   state: "all" | "entered" (anyone in) | "complete" | "partial" | "waiting" (nobody yet)
export const filterGuests = (cards = [], { q = "", state = "all" } = {}) => {
  const t = String(q).trim().toLowerCase();
  return cards.filter(c => {
    const st = scanStatus(c.scan_count, c.max_scans);
    if (state === "entered" && !(Number(c.scan_count) > 0)) return false;
    if (state === "waiting" && Number(c.scan_count) > 0) return false;
    if ((state === "complete" || state === "partial") && st !== state) return false;
    if (!t) return true;
    return [c.name, c.card_type, c.phone].some(v => String(v || "").toLowerCase().includes(t));
  }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
};

// Guests (cards) with anyone checked in vs nobody yet
export const guestCounts = (cards = []) => {
  const scanned = cards.filter(c => Number(c.scan_count) > 0).length;
  return { scanned, waiting: cards.length - scanned, sent: cards.filter(c => cardSource(c) === "sent").length };
};

// Door words for a card's scan state (scanStatus)
export const SCAN_STATE_LABEL = { pending: "Not scanned", partial: "Partly in", complete: "Fully in" };

// Card size by how many people it admits: 1 → single, 2 → double, more → group.
// Same rule as public_scan_stats() in supabase-roles-settings-scan.sql.
export const cardKind = (max = 1) => { const n = Number(max) || 1; return n <= 1 ? "single" : n === 2 ? "double" : "group"; };
export const CARD_KIND_LABEL = { single: "Single", double: "Double", group: "Group" };

// The scanner's Statistics screen: cards by size, cards scanned (anyone in) and not
// scanned, and people expected / entered
export const scanBreakdown = (cards = []) => cards.reduce((t, c) => {
  const max = Math.max(1, Number(c.max_scans) || 1), n = Math.max(0, Number(c.scan_count) || 0);
  t.cards++; t[cardKind(max)]++; t.people += max; t.entered += n;
  if (n > 0) t.scanned++; else t.notScanned++;
  if (n >= max) t.complete++;
  return t;
}, { cards: 0, single: 0, double: 0, group: 0, people: 0, entered: 0, scanned: 0, notScanned: 0, complete: 0 });

// Rows of the check-in report (Excel), by name. fmtWhen formats the last scan time.
export const scanReportRows = (cards = [], fmtWhen = (d) => d) =>
  [...cards].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).map((c, i) => {
    const max = Math.max(1, Number(c.max_scans) || 1), n = Math.max(0, Number(c.scan_count) || 0);
    return {
      "#": i + 1, Name: c.name || "", "Card type": c.card_type || "", Size: CARD_KIND_LABEL[cardKind(max)],
      Admits: max, Entered: n, "Still expected": Math.max(0, max - n), Status: SCAN_STATE_LABEL[scanStatus(n, max)],
      "Last scan": c.last_scanned_at ? fmtWhen(c.last_scanned_at) : "", Phone: c.phone || "", Comment: c.call_comment || "",
    };
  });

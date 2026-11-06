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

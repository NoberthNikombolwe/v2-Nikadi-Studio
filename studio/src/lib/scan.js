// QR codes on cards carry "ID=<event_cards.id>;Name=<name>;TypeCard=<type>". Cards
// printed before IDs were added have only Name/TypeCard — the scanner then falls back
// to finding the guest by name (and type).

export const buildQrPayload = (rec = {}) =>
  [rec.dbId && `ID=${rec.dbId}`, `Name=${rec.name || "?"}`, `TypeCard=${rec.cardType || "?"}`].filter(Boolean).join(";");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// → { id, name, cardType } (missing parts are null); a bare UUID is accepted too
export const parseQrPayload = (text = "") => {
  const raw = String(text).trim();
  if (UUID.test(raw)) return { id: raw.toLowerCase(), name: null, cardType: null };
  const out = { id: null, name: null, cardType: null };
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim();
    if (!v || v === "?") continue;
    if (k === "id" && UUID.test(v)) out.id = v.toLowerCase();
    else if (k === "name") out.name = v;
    else if (k === "typecard" || k === "type") out.cardType = v;
  }
  return out;
};

// Fallback for ID-less QR codes: exact (case-insensitive) name, narrowed by type when it helps
export const matchByName = (cards = [], { name, cardType } = {}) => {
  if (!name) return [];
  const n = name.trim().toLowerCase();
  const hits = cards.filter(c => String(c.name || "").trim().toLowerCase() === n);
  if (hits.length > 1 && cardType) {
    const t = cardType.trim().toLowerCase();
    const typed = hits.filter(c => String(c.card_type || "").trim().toLowerCase() === t);
    if (typed.length) return typed;
  }
  return hits;
};

// Text shown for a scan_card() result reason
export const SCAN_REASON = {
  ok:            "Welcome!",
  limit_reached: "Card already used",
  not_found:     "Card not found for this event",
  bad_code:      "Scan code is wrong or was changed",
};

// A random scan code for the public page: 6 characters, no look-alikes (0/O, 1/I)
export const newScanCode = (rand = Math.random) => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => abc[Math.floor(rand() * abc.length)]).join("");
};

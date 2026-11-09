// The Studio's "Clean data" chat (<CleanDataChat>, src/CleanDataChat.jsx): reading Gemini's
// Markdown answer, turning its tables into guest rows, and trimming the chat sent back.
// Gemini's instructions and limits live in supabase/functions/_shared/dataClean.js
// (shared with the ai-clean Edge Function).
import { CLEAN_LIMITS, CLEAN_IMAGE_LIMITS } from "../../supabase/functions/_shared/dataClean.js";

export { CLEAN_LIMITS, CLEAN_IMAGE_LIMITS };

/* ── Markdown → blocks ── */

// Splits a table row on its pipes ("| a | b |" → ["a", "b"]), keeping escaped "\|"
export const splitRow = (line) => {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
};

// "|---|:---:|" — the line under a table's header
const isDivider = (line) => line.includes("-") && splitRow(line).every(c => /^:?-+:?$/.test(c));
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const startsTable = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && isDivider(lines[i + 1]);

// The few Markdown blocks Gemini uses, as data the chat renders with React (never as HTML):
//   { type: "heading", level, text } | { type: "table", header, rows } | { type: "list", ordered, items }
//   | { type: "para", lines } | { type: "rule" }
// Code fences are dropped but their content kept (Gemini sometimes wraps a table in ```markdown).
export const parseMarkdown = (text = "") => {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || FENCE.test(line)) { i++; continue; }
    const h = line.match(HEADING);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2] }); i++; continue; }
    if (startsTable(lines, i)) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() && !FENCE.test(lines[i])) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, c) => cells[c] ?? ""));   // every row as wide as the header
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (RULE.test(line)) { blocks.push({ type: "rule" }); i++; continue; }
    const li = line.match(LIST_ITEM);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push(m[2]);
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i])
      && !startsTable(lines, i) && !RULE.test(lines[i]) && !LIST_ITEM.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "para", lines: para });
  }
  return blocks;
};

/* ── Inline text ── */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*)/;

// "a **b** *c*" → [{ text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", italic: true }]
export const parseInline = (text = "") => String(text ?? "").split(INLINE).filter(Boolean).map(part => {
  if (/^(\*\*|__).+\1$/.test(part)) return { text: part.slice(2, -2), bold: true };
  if (/^`.+`$/.test(part))          return { text: part.slice(1, -1), code: true };
  if (/^\*.+\*$/.test(part))        return { text: part.slice(1, -1), italic: true };
  return { text: part.replace(/\\([*_`|\\])/g, "$1") };
});

// The plain text of a cell or heading: "*Haikutajwa*" → "Haikutajwa", "<br>" → a space
export const stripInline = (text = "") =>
  parseInline(String(text ?? "").replace(/<br\s*\/?>/gi, " ")).map(p => p.text).join("").replace(/\s+/g, " ").trim();

/* ── Tables → guests ── */

// Which guest field a column holds, from its header: Name / Phone / CrdType (and the Swahili
// and spreadsheet variants), or null for anything else (S/N, #, notes…)
export const guestColumn = (header) => {
  const k = stripInline(header).toLowerCase().replace(/[^a-z]/g, "");
  if (["name", "names", "jina", "majina", "fullname", "guest", "mgeni"].includes(k)) return "name";
  if (["phone", "phonenumber", "mobile", "simu", "namba", "nambayasimu", "tel"].includes(k)) return "phone";
  if (["crdtype", "cardtype", "card", "type", "ainayakadi", "aina", "kadi"].includes(k)) return "cardType";
  return null;
};

// Card types the bot writes when none was given ("*Haikutajwa*" = not mentioned); a card must
// not print them, so they become blank
const NO_CARD_TYPE = /^(haikutajwa|not mentioned|none|n\/?a|-+|—)$/i;

// The guests in an answer's tables, in order: [{ name, phone, cardType }]. Only tables with a
// Name or Phone column count; blank rows are skipped.
export const guestRowsFromBlocks = (blocks = []) => {
  const out = [];
  for (const b of blocks) {
    if (b.type !== "table") continue;
    const cols = b.header.map(guestColumn);
    if (!cols.includes("name") && !cols.includes("phone")) continue;
    for (const row of b.rows) {
      const g = { name: "", phone: "", cardType: "" };
      cols.forEach((key, c) => { if (key && !g[key]) g[key] = stripInline(row[c]); });
      if (NO_CARD_TYPE.test(g.cardType)) g.cardType = "";
      if (g.name || g.phone) out.push(g);
    }
  }
  return out;
};

// Rows for the app's spreadsheet import (normaliseSheetRows) and the Excel download.
// "CardType" is the column name the Upload Spreadsheet button expects.
export const guestSheetRows = (guests = []) => guests.map(g => ({ Name: g.name, Phone: g.phone, CardType: g.cardType }));

// Tab-separated text (with a header) that pastes into Excel or Google Sheets as columns
export const guestsToTsv = (guests = []) => {
  const cell = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  return ["Name\tPhone\tCardType", ...guests.map(g => [g.name, g.phone, g.cardType].map(cell).join("\t"))].join("\n");
};

// How many guests are missing a phone or a card type (shown before they're used)
export const guestGaps = (guests = []) => ({
  noPhone: guests.filter(g => !g.phone).length,
  noCardType: guests.filter(g => !g.cardType).length,
});

/* ── The chat sent with each question ── */

// What an earlier message's photos become in the chat sent back: a note in their place
export const photoNote = (count) =>
  `[${count} photo${count === 1 ? "" : "s"} of a guest list ${count === 1 ? "was" : "were"} attached here; the next answer was read from ${count === 1 ? "it" : "them"}]`;

// The chat as the ai-clean function wants it: [{ role, text, images? }], oldest first,
// starting and ending with the user. Failed answers are left out; back-to-back user messages
// (one whose answer failed, then a new one) are joined, photos and all. Photos (images:
// [{ mime, data }]) go only with the newest message: earlier ones were already read into the
// answers after them, so a follow-up ("ongeza…") stays small and quick and they're replaced by
// photoNote. The oldest turns are dropped to stay within CLEAN_LIMITS.
export const chatForApi = (messages = [], limits = CLEAN_LIMITS) => {
  const turns = [];
  for (const m of messages) {
    if (!m || m.error || m.pending) continue;
    if (m.role !== "user" && m.role !== "model") continue;
    const text = typeof m.text === "string" && m.text.trim() ? m.text : "";
    const images = m.role === "user" && Array.isArray(m.images) ? m.images : [];
    if (!text && !images.length) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) {
      const joined = last.text && text ? `${last.text}\n\n${text}` : last.text || text;
      last.text = joined.length <= limits.messageChars ? joined : text;
      last.images.push(...images);
    } else {
      turns.push({ role: m.role, text, images: [...images] });
    }
  }
  while (turns.length && turns[turns.length - 1].role !== "user") turns.pop();
  turns.forEach((t, i) => {
    if (i === turns.length - 1 || !t.images.length) return;
    t.text = t.text ? `${photoNote(t.images.length)}\n${t.text}` : photoNote(t.images.length);
    t.images = [];
  });
  const kept = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (kept.length >= limits.turns || total + turns[i].text.length > limits.totalChars) break;
    kept.unshift(turns[i]);
    total += turns[i].text.length;
  }
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept.map(t => t.images.length
    ? { role: t.role, text: t.text, images: t.images.map(img => ({ mime: img.mime, data: img.data })) }
    : { role: t.role, text: t.text });
};

/* ── Long lists in batches ── */

// Gemini (Flash-Lite) drops or garbles a few guests in one long answer, but gets every one
// right in parts of a few dozen lines (measured: 150 guests in one go → 1–5 missing; in
// batches of 50 → none). Lines per request:
export const CLEAN_BATCH_LINES = 40;

// A Tanzanian mobile number in free text: optional 0 / 255 / +255, then 6 or 7 and eight more
// digits, with spaces, dots or dashes anywhere ("+255 764-123-456", "0712 345 678").
// Group 1 is the 9-digit core.
const TZ_MOBILE = /(?<!\d)(?:\+?255|0)?[\s.-]?([67](?:[\s.-]?\d){8})(?!\d)/g;

// The 9-digit cores of the Tanzanian mobile numbers in `text`, in order
export const phonesInText = (text = "") =>
  [...String(text ?? "").matchAll(TZ_MOBILE)].map(m => m[1].replace(/\D/g, ""));

// Compares a number in any format with phonesInText cores: "0764123456" / "+255764123456" → "764123456"
export const phoneCore = (raw = "") => {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("255")) return d.slice(3);
  if (d.length === 10 && d.startsWith("0")) return d.slice(1);
  return d;
};

// Splits a long pasted list into parts of `size` lines → [text] (one part = send as it is).
// Only when nearly every line holds exactly one number (one guest per line): a list whose
// guests span several lines (name, then phone, then card type) is never cut, because a cut
// could split a guest in two.
export const splitForBatches = (text = "", size = CLEAN_BATCH_LINES) => {
  const lines = String(text ?? "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length <= size) return [String(text ?? "")];
  const oneEach = lines.filter(l => phonesInText(l).length === 1).length;
  if (oneEach < lines.length * 0.8) return [String(text ?? "")];
  const parts = [];
  for (let i = 0; i < lines.length; i += size) parts.push(lines.slice(i, i + size).join("\n"));
  return parts;
};

// The questions the newest turn of the chat (chatForApi's last item) is sent as →
// [{ text, images }]. One item: asked as it is, with the chat's history. Several: each asked
// on its own, then joined (cleanInParts), so no guest is dropped:
//   - a long one-guest-per-line typed list is cut into parts (splitForBatches);
//   - two or more photos: each photo is read on its own. Typed text holding phone numbers is
//     a list of its own; other typed text ("wote ni DOUBLE") is an instruction and goes with
//     every photo.
export const turnParts = ({ text = "", images = [] } = {}, size = CLEAN_BATCH_LINES) => {
  const batches = splitForBatches(text, size);
  if (!images.length) return batches.map(t => ({ text: t, images: [] }));
  if (images.length === 1 && batches.length === 1) return [{ text, images }];
  const isList = phonesInText(text).length > 0;
  const typed = isList ? batches.filter(t => t.trim()).map(t => ({ text: t, images: [] })) : [];
  return [...typed, ...images.map(img => ({ text: isList ? "" : text, images: [img] }))];
};

// One answer made from the guests of several batches, in the bot's own layout: a table per
// card type (DOUBLE, SINGLE, any other), then those with none ("*Haikutajwa*")
export const guestsToMarkdown = (guests = []) => {
  const cell = (v) => String(v ?? "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ").trim();
  const rank = (t) => t === "DOUBLE" ? 0 : t === "SINGLE" ? 1 : t === "" ? 3 : 2;
  const types = [...new Set(guests.map(g => g.cardType))].sort((a, b) => rank(a) - rank(b));
  return types.map(t => [
    `### ${t ? `Orodha ya Kadi za ${cell(t)}` : "Orodha ya Kadi ambazo Aina Haikutajwa"}`,
    "",
    "| Name | Phone | CrdType |",
    "|---|---|---|",
    ...guests.filter(g => g.cardType === t).map(g => `| ${cell(g.name)} | ${cell(g.phone)} | ${t ? cell(t) : "*Haikutajwa*"} |`),
  ].join("\n")).join("\n\n");
};

// Guests read twice — the same guest on two overlapping screenshots — kept once →
// { guests, repeated }. Only exact repeats count (the name ignoring case and spaces, the
// number in any format, the card type); two names on one number are both kept for the user.
export const dropRepeatedGuests = (guests = []) => {
  const seen = new Set();
  const kept = guests.filter(g => {
    const key = [String(g.name ?? "").toLowerCase().replace(/\s+/g, " ").trim(), phoneCore(g.phone), String(g.cardType ?? "").toUpperCase()].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { guests: kept, repeated: guests.length - kept.length };
};

/* ── Checking an answer against what was pasted ── */

// The card type a line of a list states, read in code (Gemini sometimes gets it wrong):
// "DOUBLE" (D / DBL / DOUBLE), "SINGLE" (S / SGL / SINGLE), "" (none given) or null (both —
// unclear). Only stand-alone words count, so names ("Dr.", "Mrs", "D. Swai") and "S/N" don't.
const TYPE_DOUBLE = /(?<![\p{L}\p{N}.&'/])(?:d|dbl|double)(?![\p{L}\p{N}.'/])/iu;
const TYPE_SINGLE = /(?<![\p{L}\p{N}.&'/])(?:s|sgl|single)(?![\p{L}\p{N}.'/])/iu;
export const statedCardType = (line = "") => {
  const s = String(line ?? "").replace(TZ_MOBILE, " ");
  const d = TYPE_DOUBLE.test(s), single = TYPE_SINGLE.test(s);
  return d && single ? null : d ? "DOUBLE" : single ? "SINGLE" : "";
};

// The guests with the card types their list states (from checkAnswer's typeDiffers)
export const applyStatedTypes = (guests = [], typeDiffers = new Map()) =>
  guests.map(g => typeDiffers.has(g.phone) ? { ...g, cardType: typeDiffers.get(g.phone) } : g);

// Gemini can still drop a guest or slip a digit, and a wrong digit sends a card to a stranger,
// so every answer is checked against the user's own text (not by the AI):
//   missing    — numbers in this turn's message(s) that aren't in the answer ("0764123456" form)
//   notInList  — numbers in the answer that appear nowhere in the user's messages
//   badFormat  — numbers in the answer that aren't 10 digits starting with 0
//   typeDiffers — Map(answer phone → the card type its line states) where the answer differs;
//                 only for one-guest-per-line lists (elsewhere a type may sit on another line)
// `turnText`: the message(s) this answer replies to; `allText`: every user message so far.
// Only Tanzanian mobile numbers can be found in free text; other answer numbers are checked
// by their digits appearing anywhere in what was typed.
// `photos`: how many photos the answer was read from. Their numbers can't be found in any
// typed text, so notInList stays empty then (the chat asks the user to check them against
// the photos instead); missing, badFormat and typeDiffers still apply to what was typed.
export const checkAnswer = (guests = [], turnText = "", allText = "", { photos = 0 } = {}) => {
  const lines = String(turnText ?? "").split(/\r?\n/).filter(l => l.trim());
  const linePhones = lines.map(l => phonesInText(l));
  const typeDiffers = new Map();
  if (lines.length && linePhones.filter(p => p.length === 1).length >= lines.length * 0.8) {
    const byCore = new Map(guests.filter(g => g.phone).map(g => [phoneCore(g.phone), g]));
    lines.forEach((line, i) => {
      if (linePhones[i].length !== 1) return;
      const want = statedCardType(line);
      const g = byCore.get(linePhones[i][0]);
      if (want !== null && g && (g.cardType || "") !== want) typeDiffers.set(g.phone, want);
    });
  }
  const known = new Set(phonesInText(allText));
  const typedDigits = String(allText ?? "").replace(/\D/g, "");
  const answered = new Set(guests.map(g => phoneCore(g.phone)).filter(Boolean));
  const missing = [...new Set(phonesInText(turnText))].filter(c => !answered.has(c)).map(c => `0${c}`);
  const notInList = new Set(), badFormat = new Set();
  for (const g of guests) {
    if (!g.phone) continue;
    const core = phoneCore(g.phone);
    if (!photos && !known.has(core) && !(core.length >= 7 && typedDigits.includes(core))) notInList.add(g.phone);
    if (!/^0\d{9}$/.test(g.phone)) badFormat.add(g.phone);
  }
  return { missing, notInList, badFormat, typeDiffers };
};

/* ── Photos ── */

// Photos are read and shrunk in the browser (CleanDataChat.jsx) and kept only in memory with
// the chat; they go to Gemini with the message they're attached to and are never saved.

// A picked file bigger than this is refused before it's opened (a phone photo is 2–12 MB)
export const PHOTO_MAX_FILE_BYTES = 40 * 1024 * 1024;

// Why a picked file can't be attached, or "" when it can. Some phones give a photo no type,
// so its file name counts too.
export const photoFileProblem = (file) => {
  const name = String(file?.name || "") || "This file";
  if (!/^image\//.test(String(file?.type || "")) && !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(String(file?.name || ""))) {
    return `${name} is not a photo`;
  }
  if (!(Number(file?.size) > 0)) return `${name} is empty`;
  if (Number(file.size) > PHOTO_MAX_FILE_BYTES) return `${name} is too large (over ${PHOTO_MAX_FILE_BYTES / 1024 / 1024} MB)`;
  return "";
};

// The size a photo is drawn at: its own, or scaled down so its long side is `maxSide`
export const fitImageSize = (width, height, maxSide = CLEAN_IMAGE_LIMITS.maxSide) => {
  const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1);
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
};

// How many characters `bytes` bytes take as base64
export const base64Length = (bytes) => Math.ceil(Math.max(0, Number(bytes) || 0) / 3) * 4;

// A PNG or WebP screenshot that is small enough is sent as it is (sharpest text). Anything
// else is redrawn as a JPEG, which also turns a phone photo the right way up.
export const sendPhotoAsIs = (type, bytes, width, height, limits = CLEAN_IMAGE_LIMITS) =>
  (type === "image/png" || type === "image/webp") && Math.max(width, height) <= limits.maxSide && base64Length(bytes) <= limits.imageChars;

// The tries at redrawing a photo under CLEAN_IMAGE_LIMITS.imageChars, best first: a scale of
// the fitted size and a JPEG quality
export const PHOTO_STEPS = Object.freeze([
  { scale: 1, quality: 0.88 }, { scale: 1, quality: 0.75 }, { scale: 0.8, quality: 0.75 }, { scale: 0.6, quality: 0.7 }, { scale: 0.45, quality: 0.65 },
]);

// A file name for the Excel download: "Clean_<event>_<YYYY-MM-DD>.xlsx"
export const cleanFileName = (eventName, date) =>
  `Clean_${(String(eventName || "Guests").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "Guests")}_${date}.xlsx`;

// A messy list to try the bot with (the "Try an example" button)
export const CLEAN_EXAMPLE = [
  "S/N  MAJINA  SIMU  KADI",
  "1. MR&MRS TARIMO simu no. +255 764-123-456 D",
  "2. joy mushi - 0712 345 678 S",
  "3) Mr & Mrs JOHN MASSAWE 0754 111 222 double",
  "4. BARAKA JUMA simu 0688-000-111",
].join("\n");

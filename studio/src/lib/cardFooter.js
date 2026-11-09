// "Powered by Nikadi" + phone at the bottom of every card. Drawn by the Design preview and by
// exportCard on every downloaded, uploaded and sent card. Each event can have its own text
// and colours (events.card_footer — click the footer in Design); the defaults come from
// Settings → General (card_footer_brand / card_footer_phone, which can't be left empty).
//
// It sits in a small pill (dark by default) so it reads on light and dark templates alike,
// sized from the card's width, with the Nikadi mark before the first line. It starts at the
// bottom centre and can be dragged anywhere on the card (its centre is saved as shares of the
// card's size, so it stays put if the template's pixel size changes). It is drawn BEFORE the
// QR codes: a QR under it stays on top and scannable (Design warns about the overlap).
import { LOGO_PATH, LOGO_VIEWBOX } from "./qrLogo.js";

export const CARD_FOOTER_DEFAULTS = { brand: "Powered by Nikadi", phone: "+255 750 301 1111" };
// The footer's font (an event can choose another — src/lib/fonts.js) and how it is named in CSS
export const FOOTER_DEFAULT_FONT = "Plus Jakarta Sans";
export const fontStack = (family) => `'${String(family || FOOTER_DEFAULT_FONT).replace(/'/g, "")}', sans-serif`;

// The footer's lines from the app settings (empty ones fall back to the defaults)
export const footerLines = (settings = {}) => [
  String(settings.card_footer_brand ?? "").trim() || CARD_FOOTER_DEFAULTS.brand,
  String(settings.card_footer_phone ?? "").trim() || CARD_FOOTER_DEFAULTS.phone,
];

// ── Each event's own footer (events.card_footer, edited in Design by clicking the footer) ──
//   { brand?, phone?, bg?: "#rrggbb", bgOpacity?: 0–100, color?: "#rrggbb" } — anything unset
//   uses the default: the Settings text, a dark see-through pill and white text.
export const FOOTER_STYLE_DEFAULTS = { bg: "#000000", bgOpacity: 55, color: "#ffffff" };
// Quick looks in Design
export const FOOTER_PRESETS = [
  { label: "Dark",  bg: "#000000", bgOpacity: 55,  color: "#ffffff" },
  { label: "Light", bg: "#ffffff", bgOpacity: 85,  color: "#0d1f3c" },
  { label: "Gold",  bg: "#b8860b", bgOpacity: 90,  color: "#ffffff" },
  { label: "Clear", bg: "#000000", bgOpacity: 0,   color: "#ffffff" },
];
const HEX = /^#[0-9a-f]{6}$/i;

// An event's footer settings, cleaned (unknown or bad values dropped, text shortened)
export const normaliseFooter = (raw) => {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  if (typeof r.brand === "string") out.brand = r.brand.slice(0, 60);
  if (typeof r.phone === "string") out.phone = r.phone.slice(0, 40);
  if (HEX.test(r.bg || "")) out.bg = r.bg.toLowerCase();
  if (HEX.test(r.color || "")) out.color = r.color.toLowerCase();
  const o = Number(r.bgOpacity);
  if (r.bgOpacity !== undefined && r.bgOpacity !== null && Number.isFinite(o)) out.bgOpacity = Math.max(0, Math.min(100, Math.round(o)));
  // Where it was dragged: the pill's centre as a share of the card's width / height (0–1)
  const share = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? undefined
    : Math.round(Math.max(0, Math.min(1, Number(v))) * 10000) / 10000);
  if (share(r.x) !== undefined && share(r.y) !== undefined) { out.x = share(r.x); out.y = share(r.y); }
  // Font (a family name from src/lib/fonts.js, or an uploaded one)
  if (typeof r.font === "string" && /^[\p{L}\p{N} '-]{1,40}$/u.test(r.font.trim())) out.font = r.font.trim();
  // Size: 1 = normal (2% of the card's width), FOOTER_SIZE.min – max
  const z = Number(r.scale);
  if (r.scale !== undefined && r.scale !== null && r.scale !== "" && Number.isFinite(z)) {
    out.scale = Math.round(Math.max(FOOTER_SIZE.min, Math.min(FOOTER_SIZE.max, z)) * 100) / 100;
  }
  return out;
};

// How small / big the footer can be made, and the − / + step (shares of its normal size)
export const FOOTER_SIZE = { min: 0.5, max: 2.5, step: 0.1 };
// One − / + step from `scale`, kept in range (and free of float noise)
export const stepFooterSize = (scale = 1, dir = 1) =>
  Math.round(Math.max(FOOTER_SIZE.min, Math.min(FOOTER_SIZE.max, (Number(scale) || 1) + dir * FOOTER_SIZE.step)) * 100) / 100;

// While dragging: the footer's centre is pulled onto the card's middle line when within 1.5%
export const snapFooterX = (x) => (Math.abs(x - 0.5) < 0.015 ? 0.5 : x);

// "#rrggbb" + opacity 0–100 → "rgba(r,g,b,a)"
export const hexToRgba = (hex, opacity = 100) => {
  const h = HEX.test(hex || "") ? hex : "#000000";
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${Math.max(0, Math.min(100, opacity)) / 100})`;
};

// What a card's footer shows: the event's own text and colours over the Settings defaults.
// Empty text falls back to the default, so every card keeps its footer.
// → { lines: [brand, phone], bg: "rgba(...)", color: "#rrggbb", style: { bg, bgOpacity, color },
//     pos: { x, y } (centre, shares of the card) or null = bottom centre, scale: size (1 = normal) }
export const resolveFooter = (settings = {}, eventFooter = null) => {
  const e = normaliseFooter(eventFooter);
  const [brand, phone] = footerLines(settings);
  const style = { ...FOOTER_STYLE_DEFAULTS, ...Object.fromEntries(["bg", "bgOpacity", "color"].filter(k => e[k] !== undefined).map(k => [k, e[k]])) };
  return { lines: [e.brand?.trim() || brand, e.phone?.trim() || phone], bg: hexToRgba(style.bg, style.bgOpacity), color: style.color, style,
    pos: e.x !== undefined ? { x: e.x, y: e.y } : null, scale: e.scale ?? 1, font: e.font || FOOTER_DEFAULT_FONT };
};

// WCAG contrast ratio of two "#rrggbb" colours (1 = none, 21 = black on white)
export const contrastRatio = (a, b) => {
  const lum = (hex) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// True when the text may be hard to read on the pill (a fairly solid pill, low contrast)
export const footerHardToRead = (style = FOOTER_STYLE_DEFAULTS) =>
  style.bgOpacity >= 40 && contrastRatio(style.bg, style.color) < 3;

// Text size for a card `cw` px wide: 2% of the width, between 9 and 30 px
export const footerFontSize = (cw) => Math.max(9, Math.min(30, Math.round(cw * 0.02)));

// Where everything goes on a cw × ch card. measure(text, font) → width in px (ctx.measureText).
// pos = { x, y }: the pill's centre as shares of the card (dragged in Design); null = bottom
// centre. scale: its size (1 = normal). The pill always stays wholly on the card.
// → { fontSize, pill: { x, y, w, h, r }, mark: { x, y, w, h, scale }, lines: [{ text, x, y, font, align }] }
// Line 1 starts with the mark; text y values are middles (draw with textBaseline "middle").
export const cardFooterLayout = (cw, ch, lines = [], measure = (t) => String(t).length * 6, pos = null, scale = 1, family = FOOTER_DEFAULT_FONT, phoneFamily = family) => {
  const fs = Math.max(5, Math.round(footerFontSize(cw) * (Number(scale) || 1)));
  const lineH = Math.round(fs * 1.35);
  const padX = Math.round(fs * 0.9), padY = Math.round(fs * 0.4), margin = Math.round(fs * 0.7);
  const markH = fs * 0.85, markW = markH * (LOGO_VIEWBOX[2] / LOGO_VIEWBOX[3]), gap = fs * 0.4;
  const fonts = [`600 ${fs}px ${fontStack(family)}`, `700 ${fs}px ${fontStack(phoneFamily || family)}`];
  const widths = lines.map((t, i) => measure(t, fonts[Math.min(i, 1)]) + (i === 0 ? markW + gap : 0));
  const w = Math.ceil(Math.max(0, ...widths) + padX * 2);
  const h = lineH * lines.length + padY * 2;
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const px = pos ? clamp(Math.round(pos.x * cw - w / 2), cw - w) : Math.round((cw - w) / 2);
  const py = pos ? clamp(Math.round(pos.y * ch - h / 2), ch - h) : ch - h - margin;
  const pill = { x: px, y: py, w, h, r: Math.min(h / 2, fs * 0.9) };
  const cx = pill.x + w / 2;
  const mid = (i) => pill.y + padY + lineH * (i + 0.5);
  const first = cx - widths[0] / 2;     // line 1 (mark + text) is centred as one piece
  return {
    fontSize: fs, pill,
    mark: lines.length ? { x: first, y: mid(0) - markH / 2, w: markW, h: markH, scale: markH / LOGO_VIEWBOX[3] } : null,
    lines: lines.map((text, i) => i === 0
      ? { text, x: first + markW + gap, y: mid(0), font: fonts[0], align: "left" }
      : { text, x: cx, y: mid(i), font: fonts[1], align: "center" }),
  };
};

// The footer's box on a card (footer = resolveFooter(...)) — for the "QR overlaps the footer"
// warning in Design
export const footerPill = (cw, ch, footer, measure) =>
  footer?.lines?.length ? cardFooterLayout(cw, ch, footer.lines, measure, footer.pos, footer.scale, footer.font, footer.phoneFont).pill : null;
// True when two boxes { x, y, w, h } overlap
export const boxesOverlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Draws the footer on a card canvas. footer = resolveFooter(...) → { lines, bg, color, pos }.
// Returns the layout (the pill is where a click selects and drags the footer in Design), or null.
export const drawCardFooter = (ctx, cw, ch, footer) => {
  const lines = footer?.lines || [];
  if (!lines.length) return null;
  const L = cardFooterLayout(cw, ch, lines, (t, font) => { ctx.font = font; return ctx.measureText(t).width; }, footer.pos, footer.scale, footer.font, footer.phoneFont);
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = footer.bg || "rgba(0,0,0,0.55)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(L.pill.x, L.pill.y, L.pill.w, L.pill.h, L.pill.r);
  else ctx.rect(L.pill.x, L.pill.y, L.pill.w, L.pill.h);
  ctx.fill();
  ctx.fillStyle = footer.color || "#ffffff";
  ctx.textBaseline = "middle";
  for (const ln of L.lines) { ctx.font = ln.font; ctx.textAlign = ln.align; ctx.fillText(ln.text, ln.x, ln.y); }
  ctx.translate(L.mark.x - LOGO_VIEWBOX[0] * L.mark.scale, L.mark.y - LOGO_VIEWBOX[1] * L.mark.scale);
  ctx.scale(L.mark.scale, L.mark.scale);
  ctx.fill(new Path2D(LOGO_PATH));
  ctx.restore();
  return L;
};

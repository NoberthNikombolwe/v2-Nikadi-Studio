// The Nikadi logo in the middle of every card's QR code, without making it hard to scan.
//
// A QR code repairs damage with its error correction: level H rebuilds the code with up to
// about 30% of it covered. So cards ask for H (QR_ECC), and the logo sits on a white rounded
// square — clear space between the logo and the black squares — that covers about 5% of the
// code (QR_LOGO_BOX² of the image; a little more of the code itself), far inside what H
// repairs, and well away from the three big corner squares a scanner looks for first.
// Tested by decoding real cards with the scanner's own library at several sizes and blurs.
import { buildQrPayload } from "./scan.js";

export const QR_ECC = "H";
export const QR_LOGO_BOX = 0.22;   // the white square's side, as a share of the QR image's side
export const QR_LOGO_PAD = 0.18;   // clear space inside the square on each side, as a share of its side

// The Nikadi "NH" mark (also drawn by src/Logo.jsx) and its viewBox: x, y, width, height
export const LOGO_PATH = "M122.67,49.5v24.4h-36.59l-12.04.05-.11,18.24-36.59-42.69h-12.2v60.99h12.2v-42.69l36.43,42.5c.11.12.26.2.43.2h11.94l-.03-24.4h36.58v24.4h12.2v-60.99h-12.2Z";
export const LOGO_VIEWBOX = [22, 44, 116, 72];

// Where the white square and the logo go on a QR image drawn at (x, y), `size` px square.
// The logo keeps its shape and is centred inside the square's clear space.
export const qrLogoLayout = (x, y, size, { box = QR_LOGO_BOX, pad = QR_LOGO_PAD } = {}) => {
  const side = size * box;
  const bx = x + (size - side) / 2, by = y + (size - side) / 2;
  const inner = side * (1 - 2 * pad);
  const [, , vw, vh] = LOGO_VIEWBOX;
  const scale = Math.min(inner / vw, inner / vh);
  const w = vw * scale, h = vh * scale;
  return {
    box: { x: bx, y: by, side, radius: side * 0.2 },
    logo: { x: bx + (side - w) / 2, y: by + (side - h) / 2, w, h, scale },
  };
};

// Share of the QR image the white square covers
export const qrLogoCoverage = (box = QR_LOGO_BOX) => box * box;

// ── Is the code big enough for a logo? ──
// Error correction H needs more, smaller squares ("modules") than the plain code, and a logo
// only scans when each module still gets enough pixels. Measured by decoding cards with the
// scanner's library (5 names from short to very long, 110–260 px, sharp and photo-like blur):
// every code decoded in every view from 3 px per module up; the highest failure was 2.82.
// Below it the card keeps a plain, low-correction code (as before) — never a code that may fail.
export const QR_MIN_PX_PER_MODULE = 3;
export const QR_MARGIN_PX = 6;          // the quiet zone the QR image is made with
// Byte-mode capacity of QR versions 1–40 at error correction L and H (ISO/IEC 18004)
const QR_CAPACITY = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
      929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382,
      403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};
// How many modules across the QR code for `data` is (null when too long for any version)
export const qrModules = (data = "", ecc = QR_ECC) => {
  const bytes = new TextEncoder().encode(String(data)).length;
  const v = (QR_CAPACITY[ecc] || QR_CAPACITY.H).findIndex(cap => cap >= bytes);
  return v < 0 ? null : 17 + 4 * (v + 1);
};
// Pixels per module of the code for `data` drawn `size` px square (inside its quiet zone)
export const qrPxPerModule = (data, size, ecc = QR_ECC) => {
  const m = qrModules(data, ecc);
  return m ? (size - 2 * QR_MARGIN_PX) / m : 0;
};
// The card's QR: { ecc, logo } — H with the logo when the code is big enough, else plain L
export const qrStyle = (data, size) => qrPxPerModule(data, size, QR_ECC) >= QR_MIN_PX_PER_MODULE
  ? { ecc: QR_ECC, logo: true }
  : { ecc: "L", logo: false };
// The smallest QR size (px) that gets the logo for `data`
export const qrLogoMinSize = (data) => {
  const m = qrModules(data, QR_ECC);
  return m ? Math.ceil(m * QR_MIN_PX_PER_MODULE + 2 * QR_MARGIN_PX) : null;
};

// The QR size (px) that gives every guest's card the logo — set by the guest with the longest
// code. Saved cards carry an ID (buildQrPayload), so each one is measured with an ID.
const SAMPLE_ID = "00000000-0000-0000-0000-000000000000";
export const qrSizeForLogo = (records = []) => {
  const real = records.filter(r => r && !r.sample);
  const list = real.length ? real : [{ name: "Guest Name", cardType: "Single" }];
  return Math.max(0, ...list.map(r => qrLogoMinSize(buildQrPayload({ ...r, dbId: r.dbId || SAMPLE_ID })) || 0));
};

// Draws the white square and the logo over a QR code already drawn at (x, y, size).
// `color` is the logo's colour — the QR code's own dark colour by default.
export const drawQrLogo = (ctx, x, y, size, color = "#0d1f3c") => {
  const { box, logo } = qrLogoLayout(x, y, size);
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.side, box.side, box.radius);
  else ctx.rect(box.x, box.y, box.side, box.side);
  ctx.fill();
  ctx.translate(logo.x - LOGO_VIEWBOX[0] * logo.scale, logo.y - LOGO_VIEWBOX[1] * logo.scale);
  ctx.scale(logo.scale, logo.scale);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(LOGO_PATH));
  ctx.restore();
};

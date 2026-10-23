// Phone helpers shared by every send path (WhatsApp, SMS, VCard, reports).
// Numbers are normalised to E.164 without the "+" (e.g. 255712345678).

// Strips non-digits and rewrites local Tanzanian formats to the 255 country code:
//   0712345678 / 00255712345678 / +255712345678 / 712345678 → 255712345678
// The bare 9-digit form matters because Excel stores 0712345678 as the number
// 712345678 and silently drops the leading zero.
export const normalisePhone = (raw = "") => {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);                       // 00255… international prefix
  if (d.startsWith("0") && d.length >= 9) d = "255" + d.slice(1); // 0712… local format
  else if (d.length === 9 && /^[67]/.test(d)) d = "255" + d;     // 712… (leading 0 lost)
  return d;
};

// True when the normalised number is plausible E.164 (11–15 digits). Used to skip
// obviously bad rows in bulk sends instead of burning an API call (and credit) on them.
export const isValidPhone = (raw) => /^\d{11,15}$/.test(normalisePhone(raw));

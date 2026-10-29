import { normalisePhone, isValidPhone } from "./phone.js";

// Decides who a bulk send should actually go to. Returns the records to send to
// (with their index in `records`), a count of what was skipped and why, and the groups
// of contacts that share a phone number — so the UI can show it all in a confirmation
// dialog. A record is skipped when it:
//   - has no phone, or a phone that isn't dialable        → noPhone / invalid
//   - is already done (`isDone(rec)`), e.g. already sent  → alreadySent
//   - fails `isEligible(rec)` (optional extra requirement) → ineligible
//   - repeats a number earlier in the list                → duplicate
//     (unless `allowDuplicates` is set, in which case every such record is kept)
export const selectRecipients = (records, { isDone = () => false, isEligible = () => true, allowDuplicates = false } = {}) => {
  const targets = [];
  const skipped = { noPhone: 0, invalid: 0, alreadySent: 0, duplicate: 0, ineligible: 0 };
  const byNumber = new Map();   // normalised number → names of every otherwise-eligible record using it
  records.forEach((rec, index) => {
    if (!rec.phone)               { skipped.noPhone++;     return; }
    if (!isValidPhone(rec.phone)) { skipped.invalid++;     return; }
    if (isDone(rec))              { skipped.alreadySent++; return; }
    if (!isEligible(rec))         { skipped.ineligible++;  return; }
    const key  = normalisePhone(rec.phone);
    const name = rec.name || "(no name)";
    const seen = byNumber.get(key);
    if (seen) seen.push(name); else byNumber.set(key, [name]);
    if (seen && !allowDuplicates) { skipped.duplicate++;   return; }
    targets.push({ rec, index });
  });
  const duplicateGroups = [...byNumber]
    .filter(([, names]) => names.length > 1)
    .map(([phone, names]) => ({ phone, names }));
  return { targets, skipped, duplicateGroups };
};

// Keeps only the first record for each phone number — the "send without duplicates" list
// when `targets` came from selectRecipients(..., { allowDuplicates: true })
export const dropDuplicates = (targets) => {
  const seen = new Set();
  return targets.filter(({ rec }) => {
    const key = normalisePhone(rec.phone);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// One-line summary of skipped counts for a confirm dialog / toast ("" when nothing skipped)
export const describeSkipped = (skipped) => {
  const labels = {
    noPhone: "no phone", invalid: "invalid number", alreadySent: "already sent",
    duplicate: "duplicate number", ineligible: "not ready",
  };
  const parts = Object.entries(skipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${labels[k]}`);
  return parts.length ? `Skipping: ${parts.join(", ")}.` : "";
};

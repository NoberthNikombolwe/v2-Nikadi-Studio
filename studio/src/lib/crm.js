import { normalisePhone, isValidPhone } from "./phone.js";

// Leads → follow-ups → qualified customer → events. Tables: leads, lead_followups,
// customers, plus events.customer_id / lead_id / package_price / region
// (see supabase-schema.sql). Everything here is pure so it can be unit-tested.

// Package prices offered on the lead form (TZS); any other amount can be typed in
export const PACKAGE_OPTIONS = [800, 1000, 1200, 1500];

export const EVENT_TYPES = ["Wedding", "Conference", "Birthday", "Corporate", "Graduation", "Religious", "Workshop", "Michango", "Other"];

// Tanzania's regions, offered as suggestions (the field still accepts any text)
export const TZ_REGIONS = [
  "Arusha", "Dar es Salaam", "Dodoma", "Geita", "Iringa", "Kagera", "Katavi", "Kigoma", "Kilimanjaro",
  "Lindi", "Manyara", "Mara", "Mbeya", "Mjini Magharibi", "Morogoro", "Mtwara", "Mwanza", "Njombe",
  "Pemba North", "Pemba South", "Pwani", "Rukwa", "Ruvuma", "Shinyanga", "Simiyu", "Singida", "Songwe",
  "Tabora", "Tanga", "Unguja North", "Unguja South",
];

export const LEAD_STATUSES = {
  new:       { label: "New",       tone: "info" },
  contacted: { label: "Contacted", tone: "warn" },
  qualified: { label: "Customer",  tone: "good" },
  lost:      { label: "Lost",      tone: "bad"  },
};
export const OPEN_STATUSES = ["new", "contacted"];

export const FOLLOWUP_METHODS = {
  call:     { label: "Call",     icon: "phone" },
  whatsapp: { label: "WhatsApp", icon: "whatsapp" },
  sms:      { label: "SMS",      icon: "sms" },
  meeting:  { label: "Meeting",  icon: "handshake" },
  other:    { label: "Note",     icon: "note" },
};

// Reads a price the way people type it: "1k", "1.2k", "1,500", "TSh 2,000", 1200 → number.
// Returns null for blank input and NaN for something that isn't a price.
export const parsePrice = (input) => {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  const s = String(input).trim().toLowerCase().replace(/^(tsh|tzs)\.?\s*/, "").replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!m) return NaN;
  return Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1) * 100) / 100;
};

// "TSh 1,200" (or "—" when there's no price)
export const formatTsh = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)))
  ? "—" : `TSh ${Number(n).toLocaleString("en-US")}`;

// Field errors for the lead form ({} when valid). Name and phone are required.
export const validateLead = (form = {}) => {
  const errors = {};
  if (!String(form.name || "").trim()) errors.name = "Name is required";
  if (!String(form.phone || "").trim()) errors.phone = "Phone number is required";
  else if (!isValidPhone(form.phone)) errors.phone = "Not a valid phone number";
  const price = parsePrice(form.package_price);
  if (Number.isNaN(price) || (price !== null && price <= 0)) errors.package_price = "Enter a price like 1000 or 1.2k";
  if (form.event_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.event_date)) errors.event_date = "Pick a date";
  return errors;
};

// Field errors for the customer form: name required, phone optional but must be dialable
export const validateCustomer = (form = {}) => {
  const errors = {};
  if (!String(form.name || "").trim()) errors.name = "Name is required";
  if (String(form.phone || "").trim() && !isValidPhone(form.phone)) errors.phone = "Not a valid phone number";
  return errors;
};

const text = (v) => { const s = String(v ?? "").trim(); return s || null; };

// The leads-table row for a (valid) lead form: trimmed text, normalised phone, numeric price
export const leadToRow = (form) => ({
  name:          String(form.name).trim(),
  phone:         normalisePhone(form.phone),
  event_type:    text(form.event_type),
  event_date:    text(form.event_date),
  package_price: parsePrice(form.package_price),
  region:        text(form.region),
  venue:         text(form.venue),
  description:   text(form.description),
});

// The events-table row created when a lead is qualified
export const eventFromLead = (lead, customerId) => ({
  username:       lead.name,
  phone:          lead.phone || null,
  event_type:     lead.event_type || null,
  venue_name:     lead.venue || null,
  start_datetime: lead.event_date || null,
  status:         "active",
  customer_id:    customerId,
  lead_id:        lead.id,
  package_price:  lead.package_price ?? null,
  region:         lead.region || null,
});

// An existing customer with the same (normalised) phone number, if any
export const matchCustomer = (customers, phone) => {
  const p = normalisePhone(phone || "");
  return p ? customers.find(c => normalisePhone(c.phone || "") === p) || null : null;
};

// Local calendar date as YYYY-MM-DD (not UTC, so "today" is right in Dar es Salaam)
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// How urgent a follow-up date is: "overdue" | "today" | "soon" (next 3 days) | "later" | null
export const followupDue = (date, today = localDate()) => {
  if (!date) return null;
  if (date < today) return "overdue";
  if (date === today) return "today";
  const days = (Date.parse(date) - Date.parse(today)) / 86400000;
  return days <= 3 ? "soon" : "later";
};

// Filters leads by status ("open" = new + contacted, "all" = any) and free text
// (name, phone — local formats too — region, venue, event type, description)
export const filterLeads = (leads, { status = "open", q = "" } = {}) => {
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  return leads.filter(l => {
    if (status === "open" ? !OPEN_STATUSES.includes(l.status) : status !== "all" && l.status !== status) return false;
    if (!needle) return true;
    const hay = [l.name, l.region, l.venue, l.event_type, l.description].filter(Boolean).join(" ").toLowerCase();
    if (hay.includes(needle)) return true;
    return digits.length >= 4 && !!l.phone && (l.phone.includes(digits) || l.phone.includes(normalisePhone(digits)));
  });
};

// Open leads first, most urgent follow-up first (overdue → today → soon → later → none),
// then newest. Closed leads (customer / lost) follow, newest first.
export const sortLeads = (leads, today = localDate()) => {
  const rank = { overdue: 0, today: 1, soon: 2, later: 3 };
  return [...leads].sort((a, b) => {
    const ao = OPEN_STATUSES.includes(a.status), bo = OPEN_STATUSES.includes(b.status);
    if (ao !== bo) return ao ? -1 : 1;
    if (ao) {
      const ra = rank[followupDue(a.next_followup_date, today)] ?? 4, rb = rank[followupDue(b.next_followup_date, today)] ?? 4;
      if (ra !== rb) return ra - rb;
      if (ra < 4 && a.next_followup_date !== b.next_followup_date) return a.next_followup_date < b.next_followup_date ? -1 : 1;
    }
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
};

// Headline numbers for the Leads tab
export const summariseLeads = (leads, today = localDate()) => {
  const s = { new: 0, contacted: 0, qualified: 0, lost: 0, dueToday: 0, overdue: 0 };
  for (const l of leads) {
    if (s[l.status] !== undefined) s[l.status]++;
    if (!OPEN_STATUSES.includes(l.status)) continue;
    const due = followupDue(l.next_followup_date, today);
    if (due === "today") s.dueToday++;
    if (due === "overdue") s.overdue++;
  }
  return s;
};

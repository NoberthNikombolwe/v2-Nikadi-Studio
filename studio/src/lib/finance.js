import { parsePrice } from "./crm.js";

// Finance: money accounts (finance_accounts) and per-event income / expense
// transactions (event_transactions) — see supabase-schema.sql. Pure helpers only.

export const ACCOUNT_TYPES = {
  bank:   { label: "Bank",         icon: "bank" },
  mobile: { label: "Mobile money", icon: "smartphone" },
  cash:   { label: "Cash",         icon: "cash" },
  other:  { label: "Other",        icon: "briefcase" },
};

export const TXN_KINDS = {
  income:  { label: "Income",  partyLabel: "Received from", sign: "+" },
  expense: { label: "Expense", partyLabel: "Paid to",       sign: "−" },
};

export const TXN_CATEGORIES = {
  income:  { deposit: "Deposit", balance: "Balance payment", full: "Full payment", other: "Other income" },
  expense: { printing: "Printing", sms: "SMS credit", whatsapp: "WhatsApp credit", transport: "Transport",
             staff: "Staff / labour", venue: "Venue", design: "Design", other: "Other expense" },
};

const text = (v) => { const s = String(v ?? "").trim(); return s || null; };
const num  = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Field errors for the transaction form ({} when valid)
export const validateTransaction = (form = {}) => {
  const errors = {};
  if (!TXN_KINDS[form.kind]) errors.kind = "Choose income or expense";
  const amount = parsePrice(form.amount);
  if (amount === null) errors.amount = "Amount is required";
  else if (Number.isNaN(amount) || amount <= 0) errors.amount = "Enter an amount like 50000 or 50k";
  if (!form.txn_date || !/^\d{4}-\d{2}-\d{2}$/.test(form.txn_date)) errors.txn_date = "Pick a date";
  if (!form.account_id) errors.account_id = "Choose the account";
  if (!text(form.party)) errors.party = form.kind === "expense" ? "Who was paid?" : "Who sent the money?";
  return errors;
};

// The event_transactions row for a (valid) form
export const txnToRow = (form, eventId) => ({
  event_id:   eventId,
  kind:       form.kind,
  amount:     parsePrice(form.amount),
  txn_date:   form.txn_date,
  account_id: form.account_id || null,
  party:      text(form.party),
  category:   text(form.category),
  reference:  text(form.reference),
  note:       text(form.note),
});

// Field errors for the account form
export const validateAccount = (form = {}) => {
  const errors = {};
  if (!text(form.name)) errors.name = "Account name is required";
  if (form.type && !ACCOUNT_TYPES[form.type]) errors.type = "Unknown account type";
  return errors;
};

// Income, expenses, profit and margin (% of income kept as profit; null with no income).
// `expected` (e.g. the package price agreed) gives the still-outstanding balance.
export const summariseTransactions = (txns = [], expected = null) => {
  let income = 0, expense = 0;
  for (const t of txns) {
    if (t.kind === "income") income += num(t.amount);
    else if (t.kind === "expense") expense += num(t.amount);
  }
  const profit = income - expense;
  const marginPct = income > 0 ? Math.round((profit / income) * 1000) / 10 : null;
  const exp = expected === null || expected === undefined || expected === "" ? null : num(expected);
  const outstanding = exp === null ? null : Math.max(0, exp - income);
  return { income, expense, profit, marginPct, count: txns.length, outstanding };
};

// Tone for a margin badge: good ≥ 30 %, warn 0–30 %, bad < 0, none without income
export const marginTone = (pct) => pct === null || pct === undefined ? "none" : pct < 0 ? "bad" : pct < 30 ? "warn" : "good";

// "+38.5%" style label ("—" with no income)
export const formatPct = (pct) => pct === null || pct === undefined ? "—" : `${pct > 0 ? "+" : ""}${pct}%`;

// Money in / out / net per account id (transactions without an account under "")
export const summariseByAccount = (txns = []) => {
  const out = {};
  for (const t of txns) {
    const k = t.account_id || "";
    const s = out[k] || (out[k] = { income: 0, expense: 0, net: 0 });
    if (t.kind === "income") s.income += num(t.amount); else if (t.kind === "expense") s.expense += num(t.amount);
    s.net = s.income - s.expense;
  }
  return out;
};

// Totals per kind + category: { income: { deposit: 5000 }, expense: { printing: 2000 } }
export const summariseByCategory = (txns = []) => {
  const out = { income: {}, expense: {} };
  for (const t of txns) {
    if (!out[t.kind]) continue;
    const c = t.category || "other";
    out[t.kind][c] = (out[t.kind][c] || 0) + num(t.amount);
  }
  return out;
};

// Groups transactions by event id
export const groupByEvent = (txns = []) => {
  const out = {};
  for (const t of txns) (out[t.event_id] || (out[t.event_id] = [])).push(t);
  return out;
};

// Filters by kind ("all" | "income" | "expense"), account, date range and free text
export const filterTransactions = (txns = [], { kind = "all", account = "all", from = "", to = "", q = "" } = {}) => {
  const needle = q.trim().toLowerCase();
  return txns.filter(t => {
    if (kind !== "all" && t.kind !== kind) return false;
    if (account !== "all" && (t.account_id || "") !== account) return false;
    if (from && t.txn_date < from) return false;
    if (to && t.txn_date > to) return false;
    if (!needle) return true;
    return [t.party, t.reference, t.note, t.category].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
};

// Newest first (by transaction date, then entry time)
export const sortTransactions = (txns = []) => [...txns].sort((a, b) =>
  String(b.txn_date || "").localeCompare(String(a.txn_date || "")) ||
  String(b.created_at || "").localeCompare(String(a.created_at || "")));

// Rows for the Excel export
export const transactionExportRows = (txns, { accounts = [], events = [] } = {}) => {
  const acc = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const ev  = Object.fromEntries(events.map(e => [e.id, e.username || e.event_type || ""]));
  return sortTransactions(txns).map(t => ({
    "Date":      t.txn_date || "",
    "Event":     ev[t.event_id] || "",
    "Type":      TXN_KINDS[t.kind]?.label || t.kind,
    "Category":  TXN_CATEGORIES[t.kind]?.[t.category] || t.category || "",
    "Amount":    (t.kind === "expense" ? -1 : 1) * num(t.amount),
    "Account":   acc[t.account_id] || "",
    "From / To": t.party || "",
    "Reference": t.reference || "",
    "Note":      t.note || "",
    "By":        t.created_by || "",
  }));
};

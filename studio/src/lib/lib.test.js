import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, isValidPhone } from "./phone.js";
import { selectRecipients, dropDuplicates, describeSkipped } from "./recipients.js";
import { fillTemplate, normaliseSheetRows, recipientKey, applyMessageStatuses, sanitiseMessages } from "./messages.js";
import { N, alpha, nextThemePref } from "./theme.js";
import { buildLogRow, filterHistory, summariseHistory, historyExportRows, mergeHistory } from "./history.js";
import { parsePrice, formatTsh, validateLead, leadToRow, eventFromLead, matchCustomer, followupDue, localDate, filterLeads, sortLeads, summariseLeads, validateCustomer } from "./crm.js";

test("normalisePhone handles every local/international format", () => {
  for (const raw of ["0712345678", "+255712345678", "255712345678", "00255712345678", "712345678", 712345678, " 0712 345 678 "]) {
    assert.equal(normalisePhone(raw), "255712345678", `input: ${raw}`);
  }
  assert.equal(normalisePhone("0612345678"), "255612345678");
  assert.equal(normalisePhone(""), "");
  assert.equal(normalisePhone(undefined), "");
});

test("normalisePhone leaves other countries alone", () => {
  assert.equal(normalisePhone("+254712345678"), "254712345678");
  assert.equal(normalisePhone("+447911123456"), "447911123456");
});

test("isValidPhone rejects short or empty numbers", () => {
  assert.equal(isValidPhone("0712345678"), true);
  assert.equal(isValidPhone("712345678"), true);
  assert.equal(isValidPhone("12345"), false);
  assert.equal(isValidPhone(""), false);
  assert.equal(isValidPhone("abc"), false);
});

test("selectRecipients skips missing, invalid, done and duplicate numbers", () => {
  const records = [
    { name: "ok",      phone: "0712345678" },
    { name: "dupe",    phone: "+255712345678" },
    { name: "nophone", phone: "" },
    { name: "bad",     phone: "123" },
    { name: "done",    phone: "0755000001", sent: true },
    { name: "nocard",  phone: "0755000002", ready: false },
    { name: "ok2",     phone: "0755000003", ready: true },
  ];
  const { targets, skipped } = selectRecipients(records, {
    isDone: (r) => r.sent,
    isEligible: (r) => r.ready !== false,
  });
  assert.deepEqual(targets.map((t) => t.rec.name), ["ok", "ok2"]);
  assert.deepEqual(targets.map((t) => t.index), [0, 6]);
  assert.deepEqual(skipped, { noPhone: 1, invalid: 1, alreadySent: 1, duplicate: 1, ineligible: 1 });
});

test("selectRecipients reports groups of contacts sharing a number", () => {
  const records = [
    { name: "Anna",  phone: "0712345678" },
    { name: "Ben",   phone: "0755000001" },
    { name: "Anna M", phone: "+255712345678" },
    { name: "Anna 3", phone: "712345678" },
  ];
  const { targets, skipped, duplicateGroups } = selectRecipients(records);
  assert.deepEqual(targets.map((t) => t.rec.name), ["Anna", "Ben"]);
  assert.equal(skipped.duplicate, 2);
  assert.deepEqual(duplicateGroups, [{ phone: "255712345678", names: ["Anna", "Anna M", "Anna 3"] }]);
});

test("allowDuplicates keeps every record; dropDuplicates gives the unique list", () => {
  const records = [
    { name: "Anna",  phone: "0712345678" },
    { name: "Ben",   phone: "0755000001" },
    { name: "Anna M", phone: "+255712345678" },
  ];
  const all = selectRecipients(records, { allowDuplicates: true });
  assert.deepEqual(all.targets.map((t) => t.rec.name), ["Anna", "Ben", "Anna M"]);
  assert.equal(all.skipped.duplicate, 0);
  assert.equal(all.duplicateGroups.length, 1);
  const unique = dropDuplicates(all.targets);
  assert.deepEqual(unique.map((t) => t.rec.name), ["Anna", "Ben"]);
  assert.deepEqual(unique.map((t) => t.index), [0, 1]);
});

test("a number repeated only among skipped records is not reported as a duplicate", () => {
  const records = [
    { name: "done",  phone: "0712345678", sent: true },
    { name: "fresh", phone: "0712345678" },
  ];
  const { targets, duplicateGroups } = selectRecipients(records, { isDone: (r) => r.sent });
  assert.deepEqual(targets.map((t) => t.rec.name), ["fresh"]);
  assert.deepEqual(duplicateGroups, []);
});

test("describeSkipped is empty when nothing was skipped", () => {
  assert.equal(describeSkipped({ noPhone: 0, invalid: 0, alreadySent: 0, duplicate: 0, ineligible: 0 }), "");
  assert.equal(describeSkipped({ noPhone: 2, invalid: 0, alreadySent: 1, duplicate: 0, ineligible: 0 }),
    "Skipping: 2 no phone, 1 already sent.");
});

test("fillTemplate fills standard and extra columns, leaves unknown placeholders", () => {
  const rec = { name: "Juma", cardType: "VIP", phone: "0712345678", Table: 4 };
  assert.equal(fillTemplate("{name} {name} {cardType} {phone} T{Table} {Seat}", rec),
    "Juma Juma VIP +255712345678 T4 {Seat}");
  assert.equal(fillTemplate("Hi {name}", {}), "Hi ");
});

test("normaliseSheetRows maps header variants and keeps extra columns in order", () => {
  const { rows, columns } = normaliseSheetRows([
    { " Name ": "Anna", "Phone Number": 712345678, Card_Type: "VIP", Table: 3 },
    { Name: "Ben", Mobile: "0755000001", Seat: "B2" },
  ]);
  assert.deepEqual(rows, [
    { name: "Anna", phone: "712345678", cardType: "VIP", Table: "3" },
    { name: "Ben", phone: "0755000001", Seat: "B2" },
  ]);
  assert.deepEqual(columns, ["name", "cardType", "Table", "Seat"]);
});

test("applyMessageStatuses updates uploaded lists by index and contact lists by key", () => {
  const upload = { source: "upload", recipients: [{ name: "A", phone: "1" }, { name: "B", phone: "2" }] };
  const u = applyMessageStatuses(upload, upload.recipients, new Map([[1, "sent"]]));
  assert.equal(u.recipients[0].smsStatus, undefined);
  assert.equal(u.recipients[1].smsStatus, "sent");
  assert.equal(upload.recipients[1].smsStatus, undefined, "does not mutate the input");

  const recs = [{ name: "Anna", phone: "0712345678" }, { name: "Anna M", phone: "+255712345678" }];
  const c = applyMessageStatuses({ source: "contacts", statuses: {} }, recs, new Map([[1, "delivered"]]));
  assert.deepEqual(c.statuses, { [recipientKey(recs[1])]: "delivered" });
  assert.notEqual(recipientKey(recs[0]), recipientKey(recs[1]), "same number, different contact");
  assert.equal(recipientKey({ name: " Anna ", phone: "712345678" }), recipientKey(recs[0]));
});

test("sanitiseMessages drops junk and fills defaults", () => {
  assert.deepEqual(sanitiseMessages(null), []);
  const [m] = sanitiseMessages([null, { title: "no id" }, { id: 7, source: "weird", statuses: [] }]);
  assert.deepEqual(m, { id: "7", title: "Message 2", body: "", source: "contacts", fileName: null, columns: [], recipients: [], statuses: {} });
});

test("theme tokens are CSS variables and alpha() mixes with transparency", () => {
  assert.equal(N.sky, "var(--nk-sky)");
  assert.equal(alpha(N.teal, "44"), "color-mix(in srgb, var(--nk-teal) 27%, transparent)");
  assert.equal(alpha("#ff0000", 0.5), "color-mix(in srgb, #ff0000 50%, transparent)");
});

test("theme toggle cycles system -> light -> dark -> system", () => {
  assert.equal(nextThemePref("system"), "light");
  assert.equal(nextThemePref("light"), "dark");
  assert.equal(nextThemePref("dark"), "system");
});

test("buildLogRow normalises the phone, clips text and rejects unknown values", () => {
  const row = buildLogRow("ev1", { channel: "sms", action: "send", status: "sent", name: "Juma", phone: "0712345678", title: "Reminder", detail: "x".repeat(600) });
  assert.equal(row.event_id, "ev1");
  assert.equal(row.recipient_phone, "255712345678");
  assert.equal(row.detail.length, 500);
  assert.equal(row.message_title, "Reminder");
  assert.equal(buildLogRow("ev1", { channel: "event", action: "update" }).recipient_phone, null);
  assert.throws(() => buildLogRow("ev1", { channel: "fax", action: "send" }));
  assert.throws(() => buildLogRow("ev1", { channel: "sms", action: "send", status: "maybe" }));
  assert.throws(() => buildLogRow(null, { channel: "sms", action: "send" }));
});

const historyRows = [
  { channel: "whatsapp", action: "send",   status: "sent",     recipient_name: "Anna", recipient_phone: "255712345678", created_at: "2026-11-04T10:00:00Z" },
  { channel: "whatsapp", action: "status", status: "invalid",  recipient_name: "Anna", recipient_phone: "255712345678", created_at: "2026-11-04T10:00:09Z" },
  { channel: "whatsapp", action: "send",   status: "sent",     recipient_name: "Ben",  recipient_phone: "255755000001", created_at: "2026-11-04T10:01:00Z" },
  { channel: "sms",      action: "send",   status: "delivered", recipient_name: "Ben", recipient_phone: "255755000001", message_title: "Reminder", created_at: "2026-11-04T11:00:00Z" },
  { channel: "sms",      action: "send",   status: "failed",   recipient_name: "Cleo", recipient_phone: "255755000002", created_at: "2026-11-04T11:00:01Z" },
  { channel: "sms",      action: "bulk",   status: "ok",       detail: "1/2 sent", user_email: "ops@example.com", created_at: "2026-11-04T11:00:02Z" },
  { channel: "card",     action: "upload", status: "ok",       recipient_name: "Ben", created_at: "2026-11-04T09:00:00Z" },
];

test("summariseHistory counts sends, lets late reports override, ignores bulk rows", () => {
  assert.deepEqual(summariseHistory(historyRows),
    { cardsSent: 1, waProblems: 1, smsSent: 1, smsFailed: 1, uploads: 1, lastAt: "2026-11-04T11:00:02Z" });
  assert.deepEqual(summariseHistory([]), { cardsSent: 0, waProblems: 0, smsSent: 0, smsFailed: 0, uploads: 0, lastAt: null });
});

test("filterHistory filters by channel, status and text or local-format phone", () => {
  assert.equal(filterHistory(historyRows, { channel: "sms" }).length, 3);
  assert.equal(filterHistory(historyRows, { status: "sent" }).length, 2);
  assert.equal(filterHistory(historyRows, { q: "0755 000 001" }).length, 2);
  assert.equal(filterHistory(historyRows, { q: "reminder" }).length, 1);
  assert.equal(filterHistory(historyRows, { q: "ops@" }).length, 1);
});

test("historyExportRows gives readable labels", () => {
  const [row] = historyExportRows([historyRows[1]]);
  assert.equal(row.Channel, "WhatsApp");
  assert.equal(row.Action, "Delivery report");
  assert.equal(row.Status, "Invalid");
  assert.equal(row.Phone, "+255712345678");
});

test("mergeHistory de-duplicates by id and sorts newest first", () => {
  const a = [{ id: 1, created_at: "2026-11-04T10:00:00Z" }, { id: 2, created_at: "2026-11-04T09:00:00Z" }];
  const b = [{ id: 3, created_at: "2026-11-04T11:00:00Z" }, { id: 1, created_at: "2026-11-04T10:00:00Z" }];
  assert.deepEqual(mergeHistory(a, b).map(r => r.id), [3, 1, 2]);
});

test("parsePrice reads package prices the way people type them", () => {
  for (const [input, want] of [["1k", 1000], ["1.2k", 1200], ["1,500", 1500], ["TSh 2,000", 2000], ["tzs 800", 800], [1200, 1200], ["950", 950], [" 1.5K ", 1500]]) {
    assert.equal(parsePrice(input), want, `input: ${input}`);
  }
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice(null), null);
  assert.ok(Number.isNaN(parsePrice("abc")));
  assert.ok(Number.isNaN(parsePrice("1.2.3k")));
  assert.equal(formatTsh(1200), "TSh 1,200");
  assert.equal(formatTsh(null), "—");
});

test("validateLead requires name and a valid phone, and checks the price", () => {
  assert.deepEqual(validateLead({ name: "Amina", phone: "0712345678", package_price: "1.2k" }), {});
  const e = validateLead({ name: " ", phone: "123", package_price: "lots", event_date: "04/11/2026" });
  assert.deepEqual(Object.keys(e).sort(), ["event_date", "name", "package_price", "phone"]);
  assert.ok(validateLead({ name: "A", phone: "0712345678", package_price: "0" }).package_price);
  assert.deepEqual(validateLead({ name: "A", phone: "0712345678" }), {}, "price is optional");
});

test("leadToRow trims, normalises the phone and blanks empty fields", () => {
  assert.deepEqual(leadToRow({ name: " Amina ", phone: "0712 345 678", event_type: "Wedding", event_date: "2026-12-20",
    package_price: "1.5k", region: " Arusha ", venue: "", description: "  " }),
    { name: "Amina", phone: "255712345678", event_type: "Wedding", event_date: "2026-12-20", package_price: 1500,
      region: "Arusha", venue: null, description: null });
});

test("eventFromLead links the new event to the customer and the lead", () => {
  const ev = eventFromLead({ id: "L1", name: "Harusi ya Amina", phone: "255712345678", event_type: "Wedding", event_date: "2026-12-20",
    venue: "Serena", package_price: 1200, region: "Dar es Salaam" }, "C1");
  assert.deepEqual(ev, { username: "Harusi ya Amina", phone: "255712345678", event_type: "Wedding", venue_name: "Serena",
    start_datetime: "2026-12-20", status: "active", customer_id: "C1", lead_id: "L1", package_price: 1200, region: "Dar es Salaam" });
});

test("matchCustomer finds an existing customer by phone in any format", () => {
  const customers = [{ id: "C1", phone: "255712345678" }, { id: "C2", phone: "255755000001" }];
  assert.equal(matchCustomer(customers, "0712 345 678").id, "C1");
  assert.equal(matchCustomer(customers, "0755000009"), null);
  assert.equal(matchCustomer(customers, ""), null);
});

test("followupDue classifies dates relative to today", () => {
  const today = "2026-11-04";
  assert.equal(followupDue("2026-11-03", today), "overdue");
  assert.equal(followupDue("2026-11-04", today), "today");
  assert.equal(followupDue("2026-11-07", today), "soon");
  assert.equal(followupDue("2026-11-08", today), "later");
  assert.equal(followupDue(null, today), null);
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
});

const leadRows = [
  { id: "a", name: "Amina",  phone: "255712345678", status: "new",       region: "Arusha", next_followup_date: null,         created_at: "2026-11-01" },
  { id: "b", name: "Baraka", phone: "255755000001", status: "contacted", region: "Mwanza", next_followup_date: "2026-11-02", created_at: "2026-10-20" },
  { id: "c", name: "Cleo",   phone: "255755000002", status: "contacted", venue: "Serena",  next_followup_date: "2026-11-04", created_at: "2026-10-25" },
  { id: "d", name: "Dora",   phone: "255755000003", status: "qualified",                    next_followup_date: "2026-10-01", created_at: "2026-11-03" },
  { id: "e", name: "Eli",    phone: "255755000004", status: "lost",                                                           created_at: "2026-09-01" },
];

test("filterLeads: open by default, status filters and text/phone search", () => {
  assert.deepEqual(filterLeads(leadRows).map(l => l.id), ["a", "b", "c"]);
  assert.deepEqual(filterLeads(leadRows, { status: "all" }).length, 5);
  assert.deepEqual(filterLeads(leadRows, { status: "lost" }).map(l => l.id), ["e"]);
  assert.deepEqual(filterLeads(leadRows, { status: "all", q: "0755 000 002" }).map(l => l.id), ["c"]);
  assert.deepEqual(filterLeads(leadRows, { q: "serena" }).map(l => l.id), ["c"]);
});

test("sortLeads puts overdue and due follow-ups first, closed leads last", () => {
  assert.deepEqual(sortLeads(leadRows, "2026-11-04").map(l => l.id), ["b", "c", "a", "d", "e"]);
});

test("summariseLeads counts stages and due follow-ups (open leads only)", () => {
  assert.deepEqual(summariseLeads(leadRows, "2026-11-04"),
    { new: 1, contacted: 2, qualified: 1, lost: 1, dueToday: 1, overdue: 1 });
});

test("validateCustomer needs a name; phone is optional but must be valid", () => {
  assert.deepEqual(validateCustomer({ name: "Amina", phone: "" }), {});
  assert.deepEqual(validateCustomer({ name: "Amina", phone: "0712345678" }), {});
  assert.deepEqual(Object.keys(validateCustomer({ name: "", phone: "12" })).sort(), ["name", "phone"]);
});

// ── finance ──
import { validateTransaction, txnToRow, summariseTransactions, marginTone, formatPct, summariseByAccount,
         summariseByCategory, filterTransactions, sortTransactions, validateAccount, groupByEvent } from "./finance.js";

test("validateTransaction requires amount, date, account and party", () => {
  const e = validateTransaction({ kind: "income" });
  assert.deepEqual(Object.keys(e).sort(), ["account_id", "amount", "party", "txn_date"]);
  assert.deepEqual(validateTransaction({ kind: "expense", amount: "50k", txn_date: "2026-11-05", account_id: "a", party: "Printer" }), {});
  assert.ok(validateTransaction({ kind: "income", amount: "-5", txn_date: "2026-11-05", account_id: "a", party: "x" }).amount);
  assert.ok(validateTransaction({ kind: "bogus" }).kind);
});

test("txnToRow parses amount and trims text", () => {
  const r = txnToRow({ kind: "income", amount: "1.5k", txn_date: "2026-11-05", account_id: "a", party: " Juma ", reference: "" }, "e1");
  assert.equal(r.amount, 1500); assert.equal(r.party, "Juma"); assert.equal(r.reference, null); assert.equal(r.event_id, "e1");
});

test("summariseTransactions computes profit, margin and outstanding", () => {
  const s = summariseTransactions([
    { kind: "income", amount: 100000 }, { kind: "income", amount: "50000" }, { kind: "expense", amount: 60000 },
  ], 200000);
  assert.equal(s.income, 150000); assert.equal(s.expense, 60000); assert.equal(s.profit, 90000);
  assert.equal(s.marginPct, 60); assert.equal(s.outstanding, 50000);
  assert.equal(summariseTransactions([{ kind: "expense", amount: 10 }]).marginPct, null);
  assert.equal(summariseTransactions([]).outstanding, null);
});

test("marginTone and formatPct", () => {
  assert.equal(marginTone(null), "none"); assert.equal(marginTone(-1), "bad");
  assert.equal(marginTone(10), "warn"); assert.equal(marginTone(30), "good");
  assert.equal(formatPct(12.5), "+12.5%"); assert.equal(formatPct(-3), "-3%"); assert.equal(formatPct(null), "—");
});

test("summaries by account, category and event", () => {
  const t = [
    { event_id: "e1", kind: "income", amount: 100, account_id: "a", category: "deposit" },
    { event_id: "e1", kind: "expense", amount: 30, account_id: "a" },
    { event_id: "e2", kind: "income", amount: 50, account_id: "b", category: "deposit" },
  ];
  assert.deepEqual(summariseByAccount(t).a, { income: 100, expense: 30, net: 70 });
  assert.deepEqual(summariseByCategory(t), { income: { deposit: 150 }, expense: { other: 30 } });
  assert.equal(groupByEvent(t).e1.length, 2);
});

test("filterTransactions and sortTransactions", () => {
  const t = [
    { kind: "income", txn_date: "2026-01-02", party: "Juma", account_id: "a" },
    { kind: "expense", txn_date: "2026-03-01", party: "Printer", account_id: "b" },
  ];
  assert.equal(filterTransactions(t, { kind: "expense" }).length, 1);
  assert.equal(filterTransactions(t, { q: "juma" }).length, 1);
  assert.equal(filterTransactions(t, { from: "2026-02-01" }).length, 1);
  assert.equal(filterTransactions(t, { account: "a" }).length, 1);
  assert.equal(sortTransactions(t)[0].party, "Printer");
});

test("validateAccount requires a name", () => {
  assert.ok(validateAccount({}).name);
  assert.deepEqual(validateAccount({ name: "CRDB", type: "bank" }), {});
});

// ── guide ──
import { GUIDE_STEPS, GUIDE_STAGES, guideProgress, stepsOfStage } from "./guide.js";

test("every guide step belongs to a stage and has content", () => {
  const stages = new Set(GUIDE_STAGES.map(s => s.id));
  for (const s of GUIDE_STEPS) { assert.ok(stages.has(s.stage), s.id); assert.ok(s.title && s.what && s.why && s.tab && s.icon, s.id); }
  assert.equal(GUIDE_STAGES.reduce((n, st) => n + stepsOfStage(st.id).length, 0), GUIDE_STEPS.length);
});

test("guideProgress counts completed steps and finds the next one", () => {
  const empty = guideProgress();
  assert.equal(empty.count, 0); assert.equal(empty.next, "lead");
  const p = guideProgress({ hasLead: true, hasCustomer: true, hasEvent: true, hasDesign: true, guests: 5 });
  assert.equal(p.next, "upload");
  assert.equal(p.done.contacts, true);
  const all = guideProgress({ hasLead: true, hasCustomer: true, hasEvent: true, hasDesign: true, guests: 1, uploaded: 1, waSent: 1, smsSent: 1, txns: 1 });
  assert.equal(all.pct, 100); assert.equal(all.next, null);
});

// ── permissions / card rules / scan / calls / settings ──
import fs from "node:fs";
import { DEFAULT_MATRIX, can, canSeeTab, visibleNav, matrixFromRows, rowsForRole, validateInvite, MODULES } from "./permissions.js";
import { peopleForCardType, scanStatus, remaining, scanTotals, validateCardRule, filterGuests, guestCounts, cardSource } from "./cardRules.js";
import { buildQrPayload, parseQrPayload, matchByName, newScanCode } from "./scan.js";
import { callOptions, nextCallStatus, summariseCalls, filterCalls } from "./calls.js";
import { settingsFromRows, pickDefault, resolveChoice, validateTemplate, validateSenderId } from "./settings.js";

test("DEFAULT_MATRIX matches the SQL seed exactly", () => {
  const sql = fs.readFileSync(new URL("../../supabase-roles-settings-scan.sql", import.meta.url), "utf8");
  const seed = {};
  for (const [, r, m, p] of sql.matchAll(/\('(\w+)','(\w+)','([EV])'\)/g)) (seed[r] || (seed[r] = {}))[m] = p;
  assert.deepEqual(seed, DEFAULT_MATRIX);
});

test("can / canSeeTab / visibleNav", () => {
  assert.equal(can(null, "superuser", "finance", "edit"), true);
  assert.equal(can(null, "sales_officer", "finance"), false);
  assert.equal(can(null, "sales_officer", "design"), true);
  assert.equal(can(null, "sales_officer", "design", "edit"), false);
  assert.equal(can(null, null, "events"), false);
  assert.equal(canSeeTab(null, "finance_officer", "guide"), true);
  assert.equal(canSeeTab(null, "finance_officer", "settings"), false);
  assert.equal(canSeeTab(null, "admin", "settings"), true);
  const nav = visibleNav([{ label: "A", items: [{ id: "finance" }] }, { label: "B", items: [{ id: "events" }] }], null, "sales_officer");
  assert.deepEqual(nav.map(g => g.label), ["B"]);
  const m = matrixFromRows([{ role: "x", module: "events", can_view: true, can_edit: false }, { role: "x", module: "leads", can_view: false, can_edit: false }]);
  assert.deepEqual(m, { x: { events: "V" } });
  assert.equal(rowsForRole("x", { events: "E" }).length, MODULES.length);
  assert.ok(validateInvite({ email: "a@b.co", role: "superuser" }).role);
  assert.deepEqual(validateInvite({ email: "a@b.co", role: "superuser" }, { allowSuperuser: true }), {});
  assert.ok(validateInvite({ email: "nope", role: "admin" }).email);
});

test("peopleForCardType follows rules, numbers, then the default", () => {
  const rules = [{ name: "Double", people: 2 }, { name: "VIP Table", people: 10 }];
  assert.equal(peopleForCardType("double", rules), 2);
  assert.equal(peopleForCardType(" VIP TABLE ", rules), 10);
  assert.equal(peopleForCardType("5", rules), 5);
  assert.equal(peopleForCardType("5", rules, { numeric_card_types: false, default_people: 1 }), 1);
  assert.equal(peopleForCardType("Gold", rules, { numeric_card_types: true, default_people: 3 }), 3);
  assert.equal(peopleForCardType("0", rules), 1);
  assert.equal(scanStatus(0, 2), "pending"); assert.equal(scanStatus(1, 2), "partial"); assert.equal(scanStatus(2, 2), "complete");
  assert.equal(remaining(1, 3), 2);
  assert.deepEqual(scanTotals([{ max_scans: 2, scan_count: 2 }, { max_scans: 1, scan_count: 0 }]), { cards: 2, people: 3, entered: 2, complete: 1 });
  assert.ok(validateCardRule({ name: "double", people: 2 }, rules).name);
  assert.ok(validateCardRule({ name: "New", people: 0 }, rules).people);
});

test("QR payload round-trips and falls back to name", () => {
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  assert.deepEqual(parseQrPayload(buildQrPayload({ dbId: id, name: "Amina", cardType: "Double" })), { id, name: "Amina", cardType: "Double" });
  assert.deepEqual(parseQrPayload("Name=Juma;TypeCard=Single"), { id: null, name: "Juma", cardType: "Single" });
  assert.equal(parseQrPayload(id.toUpperCase()).id, id);
  assert.equal(parseQrPayload("ID=not-a-uuid;Name=?").id, null);
  const cards = [{ name: "Juma", card_type: "Single" }, { name: "juma", card_type: "Double" }];
  assert.equal(matchByName(cards, { name: "JUMA", cardType: "double" }).length, 1);
  assert.equal(matchByName(cards, { name: "Juma" }).length, 2);
  assert.match(newScanCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test("call flow and summary", () => {
  assert.deepEqual(callOptions(null), ["picked", "busy", "yes", "no"]);
  assert.deepEqual(callOptions("busy"), ["busy", "yes", "no"]);
  assert.deepEqual(callOptions("yes"), ["yes"]);
  assert.equal(nextCallStatus("yes", "yes"), null);
  const cards = [{ call_status: "yes", n: 2 }, { call_status: "no", n: 1 }, { call_status: null, n: 1 }];
  const s = summariseCalls(cards, c => c.n);
  assert.equal(s.peopleYes, 2); assert.equal(s.peopleExpected, 3); assert.equal(s.notCalled, 1);
  assert.equal(filterCalls(cards, { status: "todo" }).length, 1);
});

test("settings helpers", () => {
  assert.equal(settingsFromRows([{ key: "country_code", value: "254" }]).country_code, "254");
  const list = [{ name: "A", active: true }, { name: "B", active: true, is_default: true }, { name: "C", active: false }];
  assert.equal(pickDefault(list).name, "B");
  assert.equal(resolveChoice(list, "A", "name").name, "A");
  assert.equal(resolveChoice(list, "C", "name").name, "B");
  assert.ok(validateTemplate({ name: "has space" }).name);
  assert.ok(validateSenderId({ sender_id: "TOOLONGSENDER1" }).sender_id);
  assert.deepEqual(validateSenderId({ sender_id: "NIKADI 2" }), {});
});

// ── event assignments ──
import { groupAssignments, initials, eventsAssignedTo, assignableFor, validateAssignment } from "./assignments.js";

test("event team helpers", () => {
  const rows = [{ event_id: "e1", email: "zed@x.co" }, { event_id: "e1", email: "amy@x.co", full_name: "Amy Lee" }, { event_id: "e2", email: "zed@x.co" }];
  const by = groupAssignments(rows);
  assert.deepEqual(by.e1.map(a => a.email), ["amy@x.co", "zed@x.co"]);
  assert.equal(initials("Amina Said"), "AS");
  assert.equal(initials("", "juma.k@x.co"), "JK");
  assert.equal(initials("Madonna"), "MA");
  assert.equal(initials("", ""), "?");
  assert.deepEqual(eventsAssignedTo([{ id: "e1" }, { id: "e2" }, { id: "e3" }], by, "ZED@x.co").map(e => e.id), ["e1", "e2"]);
  assert.deepEqual(assignableFor([{ email: "amy@x.co" }, { email: "bo@x.co" }, { email: "off@x.co", active: false }], by.e1).map(u => u.email), ["bo@x.co"]);
  assert.ok(validateAssignment({ email: "amy@x.co" }, by.e1).email);
  assert.ok(validateAssignment({}).email);
  assert.deepEqual(validateAssignment({ email: "bo@x.co", task: "Door" }, by.e1), {});
});

test("scanner guest list: filter, counts, source", () => {
  const cards = [
    { name: "Zara", card_type: "Double", phone: "255711", scan_count: 1, max_scans: 2, wa_status: "sent" },
    { name: "Ali", card_type: "Single", phone: "255722", scan_count: 0, max_scans: 1, sms_status: "pending" },
    { name: "Mary", card_type: "Single", scan_count: 1, max_scans: 1, sms_status: "delivered" },
  ];
  assert.deepEqual(filterGuests(cards).map(c => c.name), ["Ali", "Mary", "Zara"]);
  assert.deepEqual(filterGuests(cards, { state: "waiting" }).map(c => c.name), ["Ali"]);
  assert.deepEqual(filterGuests(cards, { state: "partial" }).map(c => c.name), ["Zara"]);
  assert.deepEqual(filterGuests(cards, { state: "entered" }).map(c => c.name), ["Mary", "Zara"]);
  assert.deepEqual(filterGuests(cards, { q: "doub" }).map(c => c.name), ["Zara"]);
  assert.deepEqual(filterGuests(cards, { q: "722" }).map(c => c.name), ["Ali"]);
  assert.deepEqual(guestCounts(cards), { scanned: 2, waiting: 1, sent: 2 });
  assert.equal(cardSource(cards[1]), "uploaded");
});

import { planCardSave, hasLedger } from "./guestMerge.js";
test("re-uploading a guest list keeps calls and check-ins", () => {
  const old = [
    { id: "a", name: "Asha Said", phone: "0712000001", call_status: "yes", scan_count: 0 },
    { id: "b", name: "Juma",      phone: "255712000002", scan_count: 2 },
    { id: "c", name: "Neema",     phone: "0712000003" },                       // no ledger
    { id: "d", name: "Old Guest", phone: "0712000004", call_comment: "Busy" },  // not in new sheet
    { id: "e", name: "No Phone",  phone: "" },
  ];
  const rows = [
    { name: "asha  said", phone: "+255 712 000 001" },   // phone + name (normalised)
    { name: "Juma Ally",  phone: "0712000002" },          // phone only, renamed
    { name: "Zawadi",     phone: "0712000009" },          // new
    { name: "No Phone",   phone: "" },                    // name only
  ];
  const plan = planCardSave(rows.map((r, i) => ({ r, i })), old);
  assert.deepEqual(plan.keep.map(k => [k.i, k.id, k.matched]), [[0, "a", "phone+name"], [1, "b", "phone"], [3, "e", "name"]]);
  assert.deepEqual(plan.fresh.map(f => f.i), [2]);
  assert.deepEqual(plan.retained.map(o => o.id), ["d"]);
  assert.deepEqual(plan.remove, ["c"]);
  // dbId wins
  const p2 = planCardSave([{ r: { dbId: "c", name: "X" }, i: 0 }], old);
  assert.deepEqual(p2.keep.map(k => k.id), ["c"]);
  assert.equal(hasLedger({ scan_count: 1 }), true);
  assert.equal(hasLedger({ call_comment: "  " }), false);
});

import { splitImport } from "./guestMerge.js";
test("guest import adds only new name + phone pairs", () => {
  const cards = [{ name: "Asha Said", phone: "255712000001" }];
  const r = splitImport([
    { name: "asha said", phone: "0712 000 001" },   // existing → skip
    { name: "Asha Said", phone: "0712000099" },     // same name, other phone → add
    { name: "Juma", phone: "0712000002" },          // new
    { name: "JUMA", phone: "+255712000002" },       // repeated in file
    { name: "", phone: "0712000003" },              // invalid
  ], cards);
  assert.deepEqual(r.add.map(x => x.phone), ["0712000099", "0712000002"]);
  assert.deepEqual(r.skip.map(x => x.reason), ["Already on the guest list", "Repeated in this file"]);
  assert.equal(r.invalid.length, 1);
});

/* ── Send logic shared with the Edge Functions ── */
import { smsStatusFromGroup, matchSmsResults, classifyWaSend, scheduleTargets, describeTargetSkips, placeholdersIn } from "../../supabase/functions/_shared/messaging.js";

test("SMS provider groupIds map to sent / delivered / failed", () => {
  assert.equal(smsStatusFromGroup(18), "sent");
  assert.equal(smsStatusFromGroup(20), "delivered");
  assert.equal(smsStatusFromGroup(19), "failed");
  assert.equal(smsStatusFromGroup(undefined), "failed");
});

test("matchSmsResults hands out a repeated number's results in order", () => {
  const resp = [
    { to: 255712000001, status: { groupId: 18 } },
    { to: "255712000002", status: { groupId: 20 } },
    { to: 255712000001, status: { groupId: 19 } },
  ];
  assert.deepEqual(matchSmsResults(["0712000001", "+255712000002", "712000001", "0712000009"], resp), [18, 20, 19, undefined]);
  assert.deepEqual(matchSmsResults(["0712000001"], null), [undefined]);
});

test("classifyWaSend reads the WhatsApp provider's answer", () => {
  const body = (groupId, id, extra = {}) => JSON.stringify({ messages: [{ messageId: "m1", status: { groupId, id, ...extra } }] });
  assert.deepEqual(classifyWaSend(200, body(18, 7)), { status: "sent", pending: true, messageId: "m1", detail: null });
  assert.equal(classifyWaSend(200, body(20, 73)).status, "sent");
  assert.equal(classifyWaSend(200, body(20, 76)).status, "invalid");
  assert.equal(classifyWaSend(200, body(19, 111)).status, "invalid");
  assert.equal(classifyWaSend(200, body(5, 1, { name: "Recipient not registered" })).status, "invalid");
  assert.deepEqual(classifyWaSend(200, body(5, 1, { name: "REJECTED" })), { status: "not_sent", pending: false, messageId: "m1", detail: "REJECTED" });
  assert.equal(classifyWaSend(422, "Number is not a WhatsApp user").status, "invalid");
  assert.deepEqual(classifyWaSend(401, "nope"), { status: "not_sent", pending: false, messageId: null, detail: "HTTP 401: nope" });
  assert.equal(classifyWaSend(200, "<html>").detail, "Invalid JSON response");
});

test("scheduleTargets picks the audience, fills the text and drops duplicates", () => {
  const cards = [
    { id: "a", name: "Asha", card_type: "Double", phone: "0712000001", sms_status: "sent",    wa_status: "sent", call_status: "yes", card_url: "https://x/a.jpg" },
    { id: "b", name: "Juma", card_type: "Single", phone: "0712000002", sms_status: "pending", wa_status: "idle", call_status: "no",  card_url: null },
    { id: "c", name: "Neema", card_type: "",      phone: "",           sms_status: "pending" },
    { id: "d", name: "Bad",   card_type: "",      phone: "123" },
    { id: "e", name: "Asha", card_type: "Double", phone: "+255712000001", call_status: "picked", card_url: "https://x/a.jpg" },
    { id: "f", name: "Rehema", card_type: "VIP",  phone: "0712000001", call_status: "busy", card_url: "https://x/f.jpg" },
  ];
  const all = scheduleTargets(cards, { channel: "sms", body: "Hi {name} ({cardType})" });
  assert.deepEqual(all.targets.map(t => [t.id, t.phone, t.text]), [
    ["a", "255712000001", "Hi Asha (Double)"],
    ["b", "255712000002", "Hi Juma (Single)"],
    ["f", "255712000001", "Hi Rehema (VIP)"],
  ]);
  assert.deepEqual(all.skipped, { audience: 0, noPhone: 1, invalid: 1, noCard: 0, duplicate: 1 });
  assert.equal(describeTargetSkips(all.skipped), "3 skipped: 1 no phone, 1 invalid number, 1 duplicate");
  assert.deepEqual(scheduleTargets(cards, { channel: "sms", audience: "confirmed", body: "x" }).targets.map(t => t.id), ["a"]);
  // e repeats a's number and text, so it is a duplicate — unless a is out of the audience
  assert.deepEqual(scheduleTargets(cards, { channel: "sms", audience: "not_declined", body: "{name}" }).targets.map(t => t.id), ["a", "f"]);
  assert.deepEqual(scheduleTargets(cards, { channel: "sms", audience: "not_sent", body: "{name}" }).targets.map(t => t.id), ["b", "e", "f"]);
  // WhatsApp card: needs an uploaded card; same number + same card is a duplicate
  const wa = scheduleTargets(cards, { channel: "whatsapp", image: true });
  assert.deepEqual(wa.targets.map(t => [t.id, t.cardUrl]), [["a", "https://x/a.jpg"], ["f", "https://x/f.jpg"]]);
  assert.equal(wa.skipped.noCard, 1);
  assert.equal(wa.skipped.duplicate, 1);
  // Text-only WhatsApp: one message per number
  assert.deepEqual(scheduleTargets(cards, { channel: "whatsapp", image: false }).targets.map(t => t.id), ["a", "b"]);
  assert.equal(describeTargetSkips({}), "");
  assert.deepEqual(placeholdersIn("Hi {name}, {name}! {Table} {cardType}"), ["name", "Table", "cardType"]);
});

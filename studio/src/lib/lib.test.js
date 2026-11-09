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
    { cardsSent: 1, waProblems: 1, waDelivered: 0, waRead: 0, smsSent: 1, smsFailed: 1, smsDelivered: 0, uploads: 1, lastAt: "2026-11-04T11:00:02Z" });
  assert.deepEqual(summariseHistory([]), { cardsSent: 0, waProblems: 0, waDelivered: 0, waRead: 0, smsSent: 0, smsFailed: 0, smsDelivered: 0, uploads: 0, lastAt: null });
  // Delivery reports: delivered / read are counted, a later failure moves a send from sent to failed
  const reports = [
    { channel: "sms", action: "send", status: "sent", created_at: "1" }, { channel: "sms", action: "send", status: "sent", created_at: "2" },
    { channel: "sms", action: "status", status: "delivered", created_at: "3" }, { channel: "sms", action: "status", status: "failed", created_at: "4" },
    { channel: "whatsapp", action: "send", status: "sent", created_at: "5" }, { channel: "whatsapp", action: "status", status: "delivered", created_at: "6" },
    { channel: "whatsapp", action: "status", status: "read", created_at: "7" },
  ];
  const r = summariseHistory(reports);
  assert.deepEqual([r.smsSent, r.smsDelivered, r.smsFailed, r.cardsSent, r.waDelivered, r.waRead, r.waProblems], [1, 1, 1, 1, 1, 1, 0]);
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

test("SMS provider statuses go by the status id: group 20 alone is not 'delivered'", () => {
  assert.equal(smsStatusFromGroup(18, 51), "sent");          // ENROUTE — the normal answer to a send
  assert.equal(smsStatusFromGroup(20, 73), "delivered");
  assert.equal(smsStatusFromGroup(20, 76), "failed");        // UNDELIVERABLE is group 20 too
  assert.equal(smsStatusFromGroup(20, 77), "sent");          // ACCEPTED by the network, still on its way
  assert.equal(smsStatusFromGroup(20), "failed");            // group 20 without an id can't be called delivered
  assert.equal(smsStatusFromGroup(18), "sent");
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
  assert.deepEqual(classifyWaSend(200, body(18, 7)), { status: "sent", pending: true, messageId: "m1", statusId: 7, groupId: 18, statusName: null, detail: null });
  assert.equal(classifyWaSend(200, body(20, 73)).status, "delivered");
  assert.equal(classifyWaSend(200, body(20, 108)).status, "read");
  assert.equal(classifyWaSend(200, body(20, 109)).status, "sent");
  assert.equal(classifyWaSend(200, body(20, 76)).status, "invalid");
  assert.equal(classifyWaSend(200, body(20, 120)).status, "invalid");
  assert.equal(classifyWaSend(200, body(19, 111)).status, "invalid");
  assert.equal(classifyWaSend(200, body(5, 1, { name: "Recipient not registered" })).status, "invalid");
  assert.equal(classifyWaSend(200, body(5, 1, { name: "REJECTED" })).detail, "REJECTED");
  assert.equal(classifyWaSend(200, body(5, 1, { name: "REJECTED" })).status, "not_sent");
  assert.match(classifyWaSend(200, body(22, 57)).detail, /^FAILED_NOT_ENOUGH_CREDITS — Not enough SMS credit/);
  assert.equal(classifyWaSend(422, "Number is not a WhatsApp user").status, "invalid");
  assert.deepEqual(classifyWaSend(401, "nope"), { status: "not_sent", pending: false, messageId: null, statusId: null, groupId: null, statusName: null, detail: "HTTP 401: nope" });
  // the huge messageId stays exact (JSON.parse alone would round it)
  assert.equal(classifyWaSend(200, '{"messages":[{"messageId":7391827364512378881,"status":{"groupId":18,"id":51}}]}').messageId, "7391827364512378881");
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

/* ── Smart schedules ── */
import { buildRunTimes, validateSchedule, describeSchedule, formForEdit, patternOf, parseLocal, fmtRun, smsParts, estimateSms, audienceOptions, nextRun, defaultScheduleForm, ymd } from "./schedule.js";

const FRI_NOV_6 = new Date(2026, 10, 6, 12, 0);    // Friday 6 Nov 2026, 12:00
const weekly = (over = {}) => ({ mode: "weekly", startDate: "2026-11-09", time: "09:00", weekdays: [1, 3, 5], everyWeeks: 1, stop: "count", count: 3, until: "", ...over });

test("weekly schedule: 3 times a week, 30 sends → 10 weeks of Mon/Wed/Fri", () => {
  const { runs } = buildRunTimes(weekly({ count: 30 }), FRI_NOV_6);
  assert.equal(runs.length, 30);
  assert.ok(runs.every(r => [1, 3, 5].includes(r.getDay()) && r.getHours() === 9 && r.getMinutes() === 0));
  assert.equal(ymd(runs[0]), "2026-11-09");
  assert.equal(ymd(runs[29]), "2027-01-15");
  assert.equal(describeSchedule(weekly({ count: 30 })), "Mon, Wed, Fri at 09:00 · every week · 30 sends");
});

test("weekly schedule: every 2 weeks, 3 sends → 14 days apart", () => {
  const form = weekly({ weekdays: [6], time: "10:00", everyWeeks: 2 });
  const { runs } = buildRunTimes(form, FRI_NOV_6);
  assert.deepEqual(runs.map(ymd), ["2026-11-14", "2026-11-28", "2026-12-12"]);
  assert.equal(describeSchedule(form), "Sat at 10:00 · every 2 weeks · 3 sends");
});

test("weekly schedule starts on the start date and stops on the last day", () => {
  assert.deepEqual(buildRunTimes(weekly({ startDate: "2026-11-11" }), FRI_NOV_6).runs.map(ymd), ["2026-11-11", "2026-11-13", "2026-11-16"]);
  const until = weekly({ stop: "until", until: "2026-11-20" });
  assert.deepEqual(buildRunTimes(until, FRI_NOV_6).runs.map(ymd), ["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18", "2026-11-20"]);
  assert.equal(describeSchedule(until), "Mon, Wed, Fri at 09:00 · every week · until Fri 20 Nov");
});

test("a time today that has passed is skipped with a note", () => {
  const now = new Date(2026, 10, 11, 10, 0);   // Wed 11 Nov, 10:00
  const v = validateSchedule(weekly({ startDate: "2026-11-11", count: 2 }), { now, channel: "sms", title: "Reminder", body: "Hi {name}" });
  assert.deepEqual(v.errors, {});
  assert.deepEqual(v.runs.map(ymd), ["2026-11-13", "2026-11-16"]);
  assert.deepEqual(v.warnings, ["Today's 09:00 has already passed — the first send is Fri 13 Nov 09:00"]);
});

test("validateSchedule refuses past dates and bad forms", () => {
  const ctx = { now: FRI_NOV_6, channel: "sms", title: "Reminder", body: "Hi {name}" };
  const past = validateSchedule({ mode: "dates", dates: [{ date: "2026-11-05", time: "09:00" }, { date: "2026-11-06", time: "11:59" }, { date: "2026-11-07", time: "" }] }, ctx);
  assert.equal(past.errors.date_0, "This time has passed — pick a later one");
  assert.equal(past.errors.date_1, "This time has passed — pick a later one");
  assert.equal(past.errors.date_2, "Pick a date and a time");
  const dup = validateSchedule({ mode: "dates", dates: [{ date: "2026-11-07", time: "09:00" }, { date: "2026-11-07", time: "09:00" }] }, ctx);
  assert.equal(dup.errors.date_1, "Same time as send 1");
  assert.equal(validateSchedule({ mode: "dates", dates: [] }, ctx).errors.dates, "Add at least one date");
  assert.match(validateSchedule(weekly({ startDate: "2026-11-01" }), ctx).errors.startDate, /start date has passed/);
  assert.equal(validateSchedule(weekly({ weekdays: [] }), ctx).errors.weekdays, "Pick at least one day");
  assert.equal(validateSchedule(weekly({ count: 101 }), ctx).errors.count, "At most 100 sends");
  assert.equal(validateSchedule(weekly({ everyWeeks: 9 }), ctx).errors.everyWeeks, "Every 1 to 8 weeks");
  assert.equal(validateSchedule(weekly({ stop: "until", until: "2026-11-08" }), ctx).errors.until, "The last day is before the start date");
  const many = validateSchedule(weekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], stop: "until", until: "2027-06-01" }), ctx);
  assert.match(many.errors.runs, /more than 100 sends/);
  assert.equal(validateSchedule(weekly(), { ...ctx, title: " " }).errors.title, "Give the schedule a name, e.g. Reminder");
  assert.match(validateSchedule(weekly(), { ...ctx, body: "Karibu {name} meza {Table}" }).errors.body, /\{Table\} can't be filled in/);
  assert.equal(validateSchedule(weekly(), { ...ctx, body: "" }).errors.body, "Write the SMS text");
  assert.equal(validateSchedule(weekly(), { ...ctx, channel: "whatsapp", waTemplate: "" }).errors.waTemplate, "Pick a WhatsApp template");
  assert.deepEqual(validateSchedule(weekly(), { ...ctx, channel: "whatsapp", waTemplate: "Mwaliko", body: "" }).errors, {});
});

test("validateSchedule warns about sends after the event", () => {
  const v = validateSchedule(weekly({ count: 6 }), { now: FRI_NOV_6, channel: "sms", title: "R", body: "x", eventDate: "2026-11-14T15:00:00" });
  assert.deepEqual(v.warnings, ["3 sends are after the event (Sat 14 Nov 15:00)"]);
});

test("schedule helpers: dates, edit form, pattern, cost, audiences", () => {
  assert.equal(parseLocal("2026-02-30", "09:00"), null);
  assert.equal(parseLocal("2026-11-20", "24:00"), null);
  assert.equal(fmtRun(new Date(2027, 0, 4, 8, 5), 2026), "Mon 4 Jan 2027 08:05");
  assert.equal(describeSchedule({ mode: "dates", dates: [{ date: "2026-11-20", time: "09:00" }] }).startsWith("Once: Fri 20 Nov"), true);
  assert.equal(describeSchedule({ mode: "dates", dates: [{}, {}] }), "2 chosen dates");
  const d = defaultScheduleForm(FRI_NOV_6, "2026-12-12T14:00:00");
  assert.deepEqual([d.dates[0].date, d.startDate, d.stop, d.until], ["2026-11-07", "2026-11-06", "until", "2026-12-12"]);
  const edit = formForEdit({ mode: "weekly", startDate: "2026-10-01", time: "09:00", weekdays: [1], everyWeeks: 1, stop: "count", count: 30 }, { now: FRI_NOV_6, doneRuns: 10 });
  assert.deepEqual([edit.startDate, edit.count], ["2026-11-06", 20]);
  const editDates = formForEdit({ mode: "dates", dates: [{ date: "2026-11-01", time: "09:00" }, { date: "2026-11-20", time: "09:00" }] }, { now: FRI_NOV_6 });
  assert.deepEqual(editDates.dates, [{ date: "2026-11-20", time: "09:00" }]);
  assert.deepEqual(patternOf(weekly({ weekdays: [5, 1], extra: "dropped" })), { mode: "weekly", startDate: "2026-11-09", time: "09:00", weekdays: [1, 5], everyWeeks: 1, stop: "count", count: 3, until: "" });
  assert.equal(smsParts("x".repeat(160)), 1);
  assert.equal(smsParts("x".repeat(161)), 2);
  assert.deepEqual(estimateSms(30, 118, 1), { messages: 3540, tsh: 56640 });
  assert.deepEqual(audienceOptions({ channel: "sms", messageKey: "main" }).map(o => o.value), ["all", "not_sent", "confirmed", "not_declined"]);
  assert.deepEqual(audienceOptions({ channel: "sms", messageKey: "custom" }).map(o => o.value), ["all", "confirmed", "not_declined"]);
  assert.deepEqual(audienceOptions({ channel: "whatsapp", image: true }).map(o => o.value), ["all", "not_sent", "confirmed", "not_declined"]);
  assert.equal(nextRun([{ status: "done", run_at: "2026-11-01" }, { status: "pending", run_at: "2026-11-20" }, { status: "pending", run_at: "2026-11-10" }]).run_at, "2026-11-10");
  assert.equal(nextRun([]), null);
});

/* ── Schedules page + feedback ── */
import { filterSchedules, summariseSchedules } from "./schedule.js";
import { validateFeedback, deviceSummary, feedbackToRow, filterFeedback, summariseFeedback, feedbackExportRows } from "./feedback.js";

test("filterSchedules and summariseSchedules for the Schedules page", () => {
  const list = [
    { id: "a", channel: "sms", status: "active", title: "Reminder", event_id: "e1", event_name: "Harusi ya Asha", body: "Karibu {name}" },
    { id: "b", channel: "whatsapp", status: "paused", title: "Cards", event_id: "e2", event_name: "Send-off", wa_template: "Mwaliko" },
    { id: "c", channel: "sms", status: "done", title: "Thank you", event_id: "e1", event_name: "Harusi ya Asha" },
    { id: "d", channel: "sms", status: "cancelled", title: "Old", event_id: "e2", event_name: "Send-off" },
  ];
  assert.deepEqual(filterSchedules(list).map(s => s.id), ["a", "b"]);                       // default: active + paused
  assert.deepEqual(filterSchedules(list, { status: "all", channel: "sms" }).map(s => s.id), ["a", "c", "d"]);
  assert.deepEqual(filterSchedules(list, { status: "all", eventId: "e2" }).map(s => s.id), ["b", "d"]);
  assert.deepEqual(filterSchedules(list, { status: "all", q: "mwaliko" }).map(s => s.id), ["b"]);
  assert.deepEqual(filterSchedules(list, { status: "all", q: "asha" }).map(s => s.id), ["a", "c"]);
  const now = new Date(2026, 10, 6, 12, 0);
  const waiting = [
    { schedule_id: "a", run_at: new Date(2026, 10, 6, 18, 0).toISOString(), status: "pending" },
    { schedule_id: "a", run_at: new Date(2026, 10, 9, 9, 0).toISOString(), status: "pending" },
    { schedule_id: "a", run_at: new Date(2026, 11, 1, 9, 0).toISOString(), status: "pending" },
    { schedule_id: "b", run_at: new Date(2026, 10, 6, 18, 0).toISOString(), status: "pending" },   // paused: not counted
  ];
  assert.deepEqual(summariseSchedules(list, waiting, now), { active: 1, paused: 1, done: 1, cancelled: 1, dueToday: 1, dueWeek: 2 });
});

test("validateFeedback, feedbackToRow and deviceSummary", () => {
  assert.deepEqual(validateFeedback({ kind: "idea", rating: 0, message: "Add dark mode" }), {});
  assert.deepEqual(validateFeedback({ kind: "problem", rating: 5, message: "Camera" }), {});
  assert.equal(validateFeedback({ kind: "rant", message: "hello" }).kind, "Choose what kind of feedback this is");
  assert.equal(validateFeedback({ kind: "idea", message: " a " }).message, "Tell us a little more (at least 3 characters)");
  assert.match(validateFeedback({ kind: "idea", message: "x".repeat(4001) }).message, /under 4,000/);
  assert.equal(validateFeedback({ kind: "idea", rating: 6, message: "hello" }).rating, "Rate from 1 to 5 stars, or leave it empty");
  assert.deepEqual(feedbackToRow({ kind: "problem", rating: 0, message: "  Camera stuck  " }, { page: "Scanner", eventId: "e1", device: "Chrome · Android" }),
    { kind: "problem", rating: null, message: "Camera stuck", page: "Scanner", event_id: "e1", device: "Chrome · Android" });
  assert.equal(deviceSummary({ userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A156E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", width: 412, height: 915 }), "Chrome · Android · 412×915");
  assert.equal(deviceSummary({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }), "Safari · iOS");
  assert.equal(deviceSummary({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0" }), "Edge · Windows");
  assert.equal(deviceSummary(), "Browser");
});

test("filterFeedback, summariseFeedback and the export rows", () => {
  const list = [
    { id: 1, kind: "problem", status: "new", rating: 2, message: "Camera does not open", created_by: "help@x.com", page: "Scanner" },
    { id: 2, kind: "idea", status: "planned", rating: 5, message: "Dark scanner", created_by: "boss@x.com", page: "Scanner", reply: "Coming soon" },
    { id: 3, kind: "praise", status: "done", rating: null, message: "Love the schedules", created_by: "help@x.com", page: "SMS" },
  ];
  assert.deepEqual(filterFeedback(list).map(f => f.id), [1, 2, 3]);
  assert.deepEqual(filterFeedback(list, { status: "open" }).map(f => f.id), [1, 2]);
  assert.deepEqual(filterFeedback(list, { status: "done" }).map(f => f.id), [3]);
  assert.deepEqual(filterFeedback(list, { kind: "idea" }).map(f => f.id), [2]);
  assert.deepEqual(filterFeedback(list, { q: "coming" }).map(f => f.id), [2]);
  assert.deepEqual(filterFeedback(list, { q: "HELP@" }).map(f => f.id), [1, 3]);
  const s = summariseFeedback(list);
  assert.equal(s.total, 3); assert.equal(s.open, 2); assert.equal(s.byStatus.new, 1); assert.equal(s.byKind.problem, 1);
  assert.equal(s.avgRating, 3.5); assert.equal(s.rated, 2);
  assert.equal(summariseFeedback([]).avgRating, null);
  const [row] = feedbackExportRows([{ ...list[1], created_at: "2026-11-06T09:30:00Z", replied_by: "boss@x.com" }]);
  assert.deepEqual([row.Date, row.Kind, row.Rating, row.Status, row.Reply], ["2026-11-06 09:30", "Idea", 5, "Planned", "Coming soon"]);
});

test("Schedules and Feedback pages follow the permissions", () => {
  assert.equal(canSeeTab(null, "graphics_designer", "schedules"), true);   // WhatsApp only
  assert.equal(canSeeTab(null, "help_desk", "schedules"), true);           // SMS only
  assert.equal(canSeeTab(null, "finance_officer", "schedules"), false);
  assert.equal(canSeeTab(null, "admin", "feedback"), true);
  assert.equal(canSeeTab(null, "sales_officer", "feedback"), false);
  assert.equal(can(null, "superuser", "feedback", "edit"), true);
  assert.ok(MODULES.some(m => m.key === "feedback"));
});

/* ── Door scanner camera: always really released ── */
import { createCamera } from "./camera.js";

// A fake phone camera: only one start can hold it (like a real phone), stop() fails unless the
// scanner is running, and the camera can be made to read a code before start() has finished.
const fakePhone = ({ loadMs = 0 } = {}) => {
  const dev = { holder: null, opened: 0, released: 0, readDuringStart: null };
  const create = async () => {
    if (loadMs) await new Promise(r => setTimeout(r, loadMs));
    let state = 1;
    const cam = {
      start: (constraints, config, onCode) => new Promise((resolve, reject) => {
        if (dev.holder) { reject(Object.assign(new Error("Could not start video source"), { name: "NotReadableError" })); return; }
        dev.holder = cam; dev.opened++;
        cam.emit = (text) => onCode(text);
        if (dev.readDuringStart) { const t = dev.readDuringStart; dev.readDuringStart = null; onCode(t); onCode(t); }
        setTimeout(() => { state = 2; resolve(); }, 5);
      }),
      stop: async () => { if (state !== 2 && state !== 3) throw new Error("Cannot stop, scanner is not running or paused."); state = 1; if (dev.holder === cam) dev.holder = null; },
      clear: () => { if (state === 2) throw new Error("Cannot clear while scan is ongoing"); },
      getState: () => state,
    };
    dev.last = cam;
    return cam;
  };
  return { dev, camera: createCamera({ create, release: () => { dev.released++; } }) };
};
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

test("camera: a normal read counts once and the camera is free for the next card", async () => {
  const { dev, camera } = fakePhone();
  const codes = [];
  assert.equal(await camera.start({ onCode: t => codes.push(t) }), "started");
  dev.last.emit("ID=1"); dev.last.emit("ID=1"); dev.last.emit("ID=1");   // several frames read the same card
  await tick();
  assert.deepEqual(codes, ["ID=1"]);
  assert.equal(dev.holder, null);
  assert.equal(await camera.start({ onCode: t => codes.push(t) }), "started");   // "Scan next card" opens
  assert.equal(dev.opened, 2);
  await camera.stop();
  assert.equal(dev.holder, null);
});

test("camera: a card read before the camera finished starting still releases it (the screen-lock bug)", async () => {
  const { dev, camera } = fakePhone();
  const codes = [];
  dev.readDuringStart = "ID=7";
  assert.equal(await camera.start({ onCode: t => codes.push(t) }), "cancelled");   // it stopped itself after the read
  await tick();
  assert.deepEqual(codes, ["ID=7"]);
  assert.equal(dev.holder, null, "the camera must not keep running in the background");
  assert.equal(await camera.start({ onCode: () => {} }), "started");
});

test("camera: stopping while it is loading or starting cancels the start and leaves nothing on", async () => {
  const slow = fakePhone({ loadMs: 15 });
  const p = slow.camera.start({ onCode: () => {} });
  await slow.camera.stop();
  assert.equal(await p, "cancelled");
  assert.equal(slow.dev.opened, 0);

  const { dev, camera } = fakePhone();
  const q = camera.start({ onCode: () => {} });
  await tick(1);                       // start() has asked for the camera but not finished
  const stopped = camera.stop();
  assert.equal(await q, "cancelled");
  await stopped;
  assert.equal(dev.holder, null);
});

test("camera: a camera that can't start throws, and the next try works once it is free", async () => {
  const { dev, camera } = fakePhone();
  dev.holder = { otherApp: true };
  await assert.rejects(camera.start({ onCode: () => {} }), { name: "NotReadableError" });
  assert.ok(dev.released >= 1);
  dev.holder = null;
  assert.equal(await camera.start({ onCode: () => {} }), "started");
});

test("camera: a quick double tap opens one camera", async () => {
  const { dev, camera } = fakePhone();
  const [a, b] = await Promise.all([camera.start({ onCode: () => {} }), camera.start({ onCode: () => {} })]);
  assert.deepEqual([a, b], ["cancelled", "started"]);
  assert.equal(dev.opened, 1);
  await camera.stop();
  assert.equal(dev.holder, null);
});

/* ── Door scanner camera: picture centred in the square box, code not squashed ── */
import { coverSize, scanBoxSide, SCAN_FRAME } from "./camera.js";

// What html5-qrcode does with the sizes (html5-qrcode.js setupUi / foreverScan): a scan square
// centred on the video element, mapped to camera pixels by videoWidth/clientWidth, videoHeight/clientHeight
const libraryScanArea = (video, client, side) => {
  const x = (client.width - side) / 2, y = (client.height - side) / 2;
  const wr = video.width / client.width, hr = video.height / client.height;
  return { sx: x * wr, sy: y * hr, sw: side * wr, sh: side * hr, squash: (side * hr) / (side * wr) };
};

test("camera: a tall phone picture covers the square box, centred, with the scan area in the middle", () => {
  const box = 328;                                  // a phone: 360 px screen minus the card padding
  const phone = { width: 720, height: 1280 };
  const size = coverSize(phone.width, phone.height, box, box);
  assert.deepEqual(size, { width: 328, height: 583 });
  const side = scanBoxSide(box, size.width, size.height);
  assert.equal(side, Math.floor(box * SCAN_FRAME));
  // The video is centred on the box, so the scan square's top in box coordinates is:
  const topInBox = (size.height - side) / 2 - (size.height - box) / 2;
  assert.ok(Math.abs(topInBox - box * 0.15) < 1, "scan area starts 15% down the box, like the drawn frame");
  const area = libraryScanArea(phone, size, side);
  assert.ok(Math.abs(area.squash - 1) < 0.01, "the code is read square, not squashed");
  assert.ok(Math.abs(area.sx + area.sw / 2 - phone.width / 2) < 1 && Math.abs(area.sy + area.sh / 2 - phone.height / 2) < 1, "centre of the camera picture");
  // The old layout squeezed the video into the square (client 328×328): the code was read 1.78× squashed
  assert.ok(libraryScanArea(phone, { width: box, height: box }, 229).squash > 1.7);
});

test("camera: a wide laptop picture and a square one also cover the box", () => {
  assert.deepEqual(coverSize(1280, 720, 420, 420), { width: 747, height: 420 });
  assert.deepEqual(coverSize(640, 640, 300, 300), { width: 300, height: 300 });
  assert.equal(coverSize(0, 0, 300, 300), null);    // no picture yet
  assert.equal(scanBoxSide(420, 747, 420), 294);
  assert.equal(scanBoxSide(0), 210);                // box not measured yet → a safe default
  assert.equal(scanBoxSide(40), 50);                // the library's minimum
});

/* ── Delivery reports (NextSMS docs: Statuses, Get delivery reports, Delivery callback) ── */
import { PROVIDER_STATUS, deliveryStateOf, statusReason, parseProviderJson, smsSendResult, matchSmsMessages, waCardStatus,
  historyStatusOf, eatToIso, parseDeliveryReports, parseDeliveryCallback, reportsQueries, WA_NOT_ON_WHATSAPP } from "../../supabase/functions/_shared/messaging.js";

test("every provider status id has the right state", () => {
  const ids = (state) => Object.entries(PROVIDER_STATUS).filter(([, s]) => s.state === state).map(([id]) => Number(id)).sort((a, b) => a - b);
  assert.deepEqual(ids("sent"), [50, 51, 52, 77, 88, 109]);
  assert.deepEqual(ids("delivered"), [73]);
  assert.deepEqual(ids("read"), [108]);
  assert.equal(ids("failed").length, Object.keys(PROVIDER_STATUS).length - 8);
  assert.equal(deliveryStateOf(76, 20), "failed");
  assert.equal(deliveryStateOf("73", "20"), "delivered");     // the webhook sends ids as text
  assert.equal(deliveryStateOf(999, 18), "sent");             // unknown id: the group decides
  assert.equal(deliveryStateOf(999, 22), "failed");
  assert.equal(deliveryStateOf(999, 20), null);
  assert.equal(deliveryStateOf(null, null), null);
  assert.equal(statusReason(76), "UNDELIVERABLE — Cannot be delivered — the number may not exist");
  assert.equal(statusReason(999, "SOMETHING_NEW"), "SOMETHING_NEW");
  assert.deepEqual(WA_NOT_ON_WHATSAPP, [76, 111, 120]);
});

test("send answers keep the provider's huge messageId exact and read each number's result", () => {
  const raw = '{"messages":[{"to":"255712000001","status":{"groupId":18,"groupName":"PENDING","id":51,"name":"ENROUTE (SENT)"},"messageId":7391827364512378881,"smsCount":1},'
    + '{"to":"255712000002","status":{"groupId":19,"id":58,"name":"FAILED_SENDER"},"sendReference":7391827364512378880,"smsCount":0}]}';
  const data = parseProviderJson(raw);
  assert.equal(data.messages[0].messageId, "7391827364512378881");
  assert.equal(data.messages[1].sendReference, "7391827364512378880");
  const [a, b, c] = matchSmsMessages(["0712000001", "0712000002", "0712000003"], data.messages).map(smsSendResult);
  assert.deepEqual(a, { status: "sent", missing: false, messageId: "7391827364512378881", statusId: 51, groupId: 18, statusName: "ENROUTE (SENT)", reason: null });
  assert.equal(b.status, "failed");
  assert.equal(b.messageId, null);
  assert.equal(b.reason, "FAILED_SENDER — Sender ID not registered on that network");
  assert.deepEqual([c.status, c.missing], ["failed", true]);
});

test("card and History statuses for each delivery state", () => {
  assert.equal(waCardStatus("read", 108), "read");
  assert.equal(waCardStatus("delivered", 73), "delivered");
  assert.equal(waCardStatus("sent", 109), "sent");
  assert.equal(waCardStatus("failed", 120), "invalid");
  assert.equal(waCardStatus("failed", 114), "notSent");
  assert.equal(historyStatusOf("whatsapp", "failed", 76), "invalid");
  assert.equal(historyStatusOf("whatsapp", "failed", 79), "not_sent");
  assert.equal(historyStatusOf("whatsapp", "read", 108), "read");
  assert.equal(historyStatusOf("sms", "delivered", 73), "delivered");
  assert.equal(historyStatusOf("sms", "failed", 74), "failed");
  // every History status used here is one buildLogRow accepts
  for (const st of ["read", "delivered", "sent", "invalid", "not_sent", "failed"]) {
    assert.doesNotThrow(() => buildLogRow("e1", { channel: "sms", action: "status", status: st }));
  }
});

test("delivery reports, the webhook payload and the report lookups", () => {
  assert.equal(eatToIso("2026-10-20 10:15:07"), "2026-10-20T10:15:07+03:00");
  assert.equal(eatToIso("2026-10-20 10:15"), "2026-10-20T10:15:00+03:00");
  assert.equal(eatToIso(""), null);
  const reports = parseDeliveryReports('{"results":[{"messageId":"7391827364512378881","sentAt":"2026-10-20 10:15:00","doneAt":"2026-10-20 10:15:07",'
    + '"to":"255712345678","status":{"groupId":20,"groupName":"DELIVERED","id":73,"name":"DELIVERED"},"delivery":"DELIVERED"},'
    + '{"messageId":7391827364512378999,"status":{"groupId":20,"id":76,"name":"UNDELIVERABLE"}},{"to":"x"},{"messageId":"1"}]}');
  assert.deepEqual(reports, [
    { message_id: "7391827364512378881", status_id: 73, group_id: 20, status_name: "DELIVERED", done_at: "2026-10-20T10:15:07+03:00" },
    { message_id: "7391827364512378999", status_id: 76, group_id: 20, status_name: "UNDELIVERABLE", done_at: null },
  ]);
  assert.deepEqual(parseDeliveryReports("not json"), []);
  assert.deepEqual(parseDeliveryReports({ results: null }), []);
  assert.deepEqual(parseDeliveryCallback({ token: "t", messageId: "7391827364512378881", status: "DELIVERED", id: "73" }),
    { kind: "status", message_id: "7391827364512378881", status_id: 73, status_name: "DELIVERED" });
  assert.deepEqual(parseDeliveryCallback({ token: "t", messageId: "5", response: "Yes", payload: "confirm-1", text: "Yes" }),
    { kind: "reply", message_id: "5", text: "Yes" });
  assert.deepEqual(parseDeliveryCallback({ token: "t" }), { kind: "ping" });
  assert.deepEqual(parseDeliveryCallback(null), { kind: "ping" });
  const ids = Array.from({ length: 120 }, (_, i) => String(1000 + i));
  const qs = reportsQueries([...ids, ids[0], "", null], "whatsapp");
  assert.equal(qs.length, 3);
  assert.ok(qs[0].startsWith("?channel=whatsapp&size=200&messageId=1000&messageId=1001"));
  assert.equal(qs[0].match(/messageId=/g).length, 50);
  assert.equal(qs[2].match(/messageId=/g).length, 20);
  assert.deepEqual(reportsQueries([]), []);
});

test("SQL delivery_state() matches PROVIDER_STATUS exactly", () => {
  const sql = fs.readFileSync(new URL("../../supabase-roles-settings-scan.sql", import.meta.url), "utf8");
  const fn = sql.slice(sql.indexOf("FUNCTION public.delivery_state"), sql.indexOf("$$;", sql.indexOf("FUNCTION public.delivery_state")));
  const fromSql = {};
  for (const [, ids, state] of fn.matchAll(/WHEN p_id IN \(([\d,]+)\) THEN '(\w+)'/g)) ids.split(",").forEach(id => { fromSql[Number(id)] = state; });
  const fromJs = Object.fromEntries(Object.entries(PROVIDER_STATUS).map(([id, s]) => [Number(id), s.state]));
  assert.deepEqual(fromSql, fromJs);
  assert.match(fn, /WHEN p_group = 18 THEN 'sent'/);
  assert.match(fn, /WHEN p_group IN \(19,22\) THEN 'failed'/);
});

/* ── Delivery results in the app ── */
import { indexDeliveries, extraStatusOf, deliveryNote, guestStatusCounts, deliveryCounts, failureReasons, filterDeliveries,
  deliveryExportRows, parseProviderLogs, providerLogsQuery } from "./deliveries.js";

const dRows = [
  { id: 1, channel: "sms", message_key: "main", event_card_id: "c1", phone: "255712000001", recipient_name: "Asha", status: "failed", reason: "UNDELIVERABLE — Cannot be delivered — the number may not exist", sent_at: "2026-11-07T08:00:00Z", source: "check" },
  { id: 2, channel: "sms", message_key: "main", event_card_id: "c1", phone: "255712000001", recipient_name: "Asha", status: "delivered", sent_at: "2026-11-07T09:00:00Z", done_at: "2026-11-07T09:00:05Z", source: "callback" },
  { id: 3, channel: "whatsapp", message_key: "card", event_card_id: "c1", phone: "255712000001", recipient_name: "Asha", status: "read", sent_at: "2026-11-07T08:30:00Z", source: "callback" },
  { id: 4, channel: "sms", message_key: "x1", event_card_id: "c2", phone: "255712000002", recipient_name: "Juma", status: "failed", reason: "EXPIRED — Not delivered in time", message_title: "Directions", sent_at: "2026-11-07T08:10:00Z", source: "check" },
  { id: 5, channel: "sms", message_key: "custom", phone: "255712000003", recipient_name: "Neema", status: "sent", sent_at: "2026-11-07T08:20:00Z", source: "send" },
  { id: 6, channel: "whatsapp", message_key: "card", event_card_id: "c2", phone: "255712000002", recipient_name: "Juma", status: "failed", reason: "UNDELIVERABLE — Cannot be delivered — the number may not exist", sent_at: "2026-11-07T08:40:00Z", source: "callback" },
];

test("indexDeliveries keeps each guest's latest send; extra messages get their result on top", () => {
  const idx = indexDeliveries(dRows);
  assert.equal(idx.byCard.get("sms|main|c1").id, 2);          // the newer send wins
  assert.equal(idx.byCard.get("whatsapp|card|c1").status, "read");
  assert.equal(idx.byCard.size, 3);
  assert.equal(extraStatusOf(idx, "x1", { name: "juma ", phone: "0712000002" }, "sent"), "failed");
  assert.equal(extraStatusOf(idx, "x1", { name: "Other", phone: "0712000009" }, "sent"), "sent");
  assert.equal(idx.byExtra.size, 1);                           // custom texts aren't an extra message
  assert.match(deliveryNote(dRows[0]), /^UNDELIVERABLE — Cannot be delivered/);
  assert.match(deliveryNote(dRows[1]), /^Delivered to the phone · /);
  assert.equal(deliveryNote(null), "");
});

test("Reports counts, failure reasons, the delivery log filter and export", () => {
  const g = guestStatusCounts([
    { smsStatus: "delivered", waStatus: "read" }, { smsStatus: "sent", waStatus: "delivered" }, { smsStatus: "failed", waStatus: "invalid" },
    { smsStatus: "pending", waStatus: "idle" }, { smsStatus: "pending", waStatus: "notSent" }, { sample: true, smsStatus: "sent" },
  ]);
  assert.deepEqual(g, { total: 5, sms: { delivered: 1, sent: 1, failed: 1, notSent: 2 }, wa: { read: 1, delivered: 1, sent: 0, invalid: 1, failed: 1, notSent: 1 } });
  assert.deepEqual(deliveryCounts(dRows), { total: 6, sent: 1, delivered: 1, read: 1, failed: 3, sms: 4, whatsapp: 2 });
  assert.deepEqual(failureReasons(dRows), [
    { reason: "EXPIRED — Not delivered in time", channel: "sms", count: 1 },
    { reason: "UNDELIVERABLE — Cannot be delivered — the number may not exist", channel: "sms", count: 1 },
    { reason: "UNDELIVERABLE — Cannot be delivered — the number may not exist", channel: "whatsapp", count: 1 },
  ]);
  assert.deepEqual(filterDeliveries(dRows, { status: "failed" }).map(d => d.id), [1, 4, 6]);
  assert.deepEqual(filterDeliveries(dRows, { channel: "whatsapp" }).map(d => d.id), [3, 6]);
  assert.deepEqual(filterDeliveries(dRows, { q: "directions" }).map(d => d.id), [4]);
  assert.deepEqual(filterDeliveries(dRows, { q: "0712 000 003" }).map(d => d.id), [5]);
  assert.deepEqual(filterDeliveries(dRows, { q: "expired" }).map(d => d.id), [4]);
  const [row] = deliveryExportRows([dRows[0]]);
  assert.deepEqual([row.Phone, row.Channel, row.Status, row.Reason, row["Updated by"]], ["+255712000001", "SMS", "Failed", dRows[0].reason, "check"]);
});

test("the NextSMS account log: query and rows", () => {
  assert.equal(providerLogsQuery({ since: "2026-11-07", until: "2026-11-07", channel: "whatsapp", to: "0712 000 001", offset: 200 }),
    "?sentSince=2026-11-07&sentUntil=2026-11-07&channel=whatsapp&to=255712000001&limit=200&offset=200");
  assert.equal(providerLogsQuery({ since: "2026-11-01" }), "?sentSince=2026-11-01&limit=200");
  const rows = parseProviderLogs('{"results":[{"messageId":7391827364512378881,"to":"255712345678","from":"NIKADI","channel":"Internet SMS","sentAt":"2026-11-07 10:15:00","doneAt":"2026-11-07 10:15:07","smsCount":1,"status":{"groupId":20,"id":76,"name":"UNDELIVERABLE"},"delivery":"UNDELIVERABLE"},'
    + '{"messageId":"5","to":"255712000001","sentAt":"2026-11-07 10:16:00","status":{"groupId":18,"id":51,"name":"ENROUTE"},"delivery":null}]}');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].messageId, rows[0].state, rows[0].reason, rows[0].sentAt], ["7391827364512378881", "failed", "UNDELIVERABLE — Cannot be delivered — the number may not exist", "2026-11-07T10:15:00+03:00"]);
  assert.deepEqual([rows[1].state, rows[1].doneAt], ["sent", null]);
  assert.deepEqual(parseProviderLogs("oops"), []);
});

// ── scanner on phones: statistics, check-in report, phone table columns ──
import { cardKind, scanBreakdown, scanReportRows, SCAN_STATE_LABEL } from "./cardRules.js";
import { hideColumnRules, MAX_HIDDEN_COLUMN } from "./mobileTable.js";

test("cardKind sorts cards by how many they admit", () => {
  assert.deepEqual([0, 1, 2, 3, 30, undefined, "2"].map(cardKind), ["single", "single", "double", "group", "group", "single", "double"]);
});

test("scanBreakdown counts cards by size, scanned and not scanned", () => {
  const cards = [
    { max_scans: 1, scan_count: 1 }, { max_scans: 1, scan_count: 0 }, { max_scans: 2, scan_count: 1 },
    { max_scans: 30, scan_count: 30 }, { max_scans: 5, scan_count: 0 }, {},
  ];
  assert.deepEqual(scanBreakdown(cards), { cards: 6, single: 3, double: 1, group: 2, people: 40, entered: 32, scanned: 3, notScanned: 3, complete: 2 });
  assert.equal(scanBreakdown().cards, 0);
});

test("scanReportRows lists every guest by name with their door state", () => {
  const rows = scanReportRows([
    { name: "Zara", card_type: "Double", max_scans: 2, scan_count: 1, last_scanned_at: "2026-11-08T18:00:00Z", phone: "255712000001" },
    { name: "Amina", card_type: "Single", max_scans: 1, scan_count: 0, call_comment: "VIP" },
  ], () => "08 Nov 21:00");
  assert.deepEqual(rows.map(r => [r["#"], r.Name, r.Size, r.Entered, r["Still expected"], r.Status, r["Last scan"], r.Comment]), [
    [1, "Amina", "Single", 0, 1, SCAN_STATE_LABEL.pending, "", "VIP"],
    [2, "Zara", "Double", 1, 1, SCAN_STATE_LABEL.partial, "08 Nov 21:00", ""],
  ]);
});

test("hideColumnRules hides the numbered column, never a spanning row", () => {
  const css = hideColumnRules(".nk-table");
  assert.ok(css.includes(".nk-table.m-hide-3 tr > :nth-child(3):not([colspan])"));
  assert.equal(css.split(",").length, MAX_HIDDEN_COLUMN);
  assert.equal(hideColumnRules(".t", 2).split(",").length, 2);
});

// ── phone bottom navigation ──
import { phoneNavGroups, groupOfTab, sectionTab } from "./permissions.js";

test("phoneNavGroups puts the event sections first and keeps four", () => {
  const g = (label, ...ids) => ({ label, items: ids.map(id => ({ id })) });
  const all = [g("Sales", "events", "leads"), g("Studio", "design", "sms"), g("Insight", "reports"), g("Guests", "calls", "scanner"),
    g("Schedules", "schedules"), g("Money", "finance"), g("Admin", "settings"), g("Help", "guide")];
  assert.deepEqual(phoneNavGroups(all).map(x => x.label), ["Sales", "Studio", "Guests", "Insight"]);
  // no event open: the event-only sections are gone, so the others move up
  assert.deepEqual(phoneNavGroups(all.filter(x => !["Studio", "Insight", "Guests"].includes(x.label))).map(x => x.label), ["Sales", "Schedules", "Money", "Admin"]);
  assert.deepEqual(phoneNavGroups([g("Help", "guide"), g("Other", "x"), g("Sales", "events")]).map(x => x.label), ["Sales", "Help", "Other"]);
  assert.deepEqual(phoneNavGroups([]), []);
});

test("groupOfTab and sectionTab: a section opens the page used last there", () => {
  const studio = { label: "Studio", items: [{ id: "design" }, { id: "sms" }, { id: "whatsapp" }] };
  const groups = [{ label: "Sales", items: [{ id: "events" }] }, studio];
  assert.equal(groupOfTab(groups, "sms"), studio);
  assert.equal(groupOfTab(groups, "nope"), null);
  assert.equal(sectionTab(studio), "design");
  assert.equal(sectionTab(studio, { Studio: "whatsapp" }), "whatsapp");
  assert.equal(sectionTab(studio, { Studio: "finance" }), "design");   // not in the section (any more)
});

// ── schedules: the device clock against the server's ──
import { clockOffset, serverNow, clockProblem, CLOCK_BLOCK_MS } from "./schedule.js";

test("clockOffset measures how far the device clock is off, from one request", () => {
  const sent = Date.parse("2026-11-08T10:00:00Z"), got = sent + 400;          // 0.4 s round trip
  assert.equal(clockOffset("2026-11-08T10:05:00.200+00:00", sent, got), 5 * 60_000);   // device 5 min behind
  assert.equal(clockOffset("2026-11-08T09:58:00.200Z", sent, got), -2 * 60_000);       // device 2 min ahead
  assert.equal(clockOffset("not a time", sent, got), null);
  assert.equal(clockOffset(null, sent, got), null);
  assert.equal(serverNow(5 * 60_000, sent).toISOString(), "2026-11-08T10:05:00.000Z");
  assert.equal(serverNow(null, sent).getTime(), sent);
});

test("clockProblem: nothing under a minute, a note for minutes, a block for a wrong time zone", () => {
  const now = new Date(2026, 10, 8, 10, 7);
  assert.equal(clockProblem(null, now), null);
  assert.equal(clockProblem(30_000, now), null);
  const note = clockProblem(4 * 60_000, now);
  assert.equal(note.block, false);
  assert.match(note.text, /4 min behind the server's clock — it is 10:07 now/);
  const zone = clockProblem(-3 * 3600_000, now);
  assert.equal(zone.block, true);
  assert.match(zone.text, /3 h ahead of the server's clock \(it is 10:07 now\).*automatic date, time and time zone/);
  assert.match(clockProblem(-(80 * 60_000), now).text, /1 h 20 min ahead/);
  assert.equal(clockProblem(CLOCK_BLOCK_MS - 60_000, now).block, false);
});

test("a schedule is checked against the server's time, not the device's", () => {
  // The device shows 10:00 but the server says 10:05: a send at 10:03 has passed
  const device = new Date(2026, 10, 8, 10, 0), offset = 5 * 60_000;
  const form = { mode: "dates", dates: [{ date: "2026-11-08", time: "10:03" }] };
  const ctx = { channel: "sms", title: "Reminder", body: "Hi {name}" };
  assert.equal(validateSchedule(form, { ...ctx, now: device }).errors.date_0, undefined);
  const v = validateSchedule(form, { ...ctx, now: serverNow(offset, device.getTime()), clockOffset: offset });
  assert.equal(v.errors.date_0, "This time has passed — pick a later one");
  assert.ok(v.warnings.some(w => /5 min behind/.test(w)));
  // hours off: saving is blocked until the device is fixed
  const later = { mode: "dates", dates: [{ date: "2026-11-09", time: "09:00" }] };
  const blocked = validateSchedule(later, { ...ctx, now: serverNow(-3 * 3600_000, device.getTime()), clockOffset: -3 * 3600_000 });
  assert.match(blocked.errors.clock, /3 h ahead/);
  assert.equal(blocked.runs.length, 1);
});

// ── SMS schedules handed to NextSMS ──
import { eatDateTime, handoverBatches, handoverReference, scheduleControls, handoverDetail, RUN_STATUS } from "./schedule.js";
import { providerErrorText } from "./messages.js";

test("eatDateTime gives NextSMS the date and time in East Africa Time, whatever the device's zone", () => {
  assert.deepEqual(eatDateTime(new Date("2026-11-20T06:00:00Z")), { date: "2026-11-20", time: "09:00" });
  assert.deepEqual(eatDateTime("2026-11-20T22:30:00Z"), { date: "2026-11-21", time: "01:30" });   // past midnight in Dar es Salaam
  assert.equal(eatDateTime("nope"), null);
});

test("handoverBatches: batches of 500, each send time starting from a different guest", () => {
  const t = Array.from({ length: 5 }, (_, i) => ({ phone: `25571200000${i}` }));
  assert.deepEqual(handoverBatches(t, 0, 2).map(b => b.map(x => x.phone.slice(-1))), [["0", "1"], ["2", "3"], ["4"]]);
  assert.deepEqual(handoverBatches(t, 1)[0].map(x => x.phone.slice(-1)), ["1", "2", "3", "4", "0"]);
  assert.deepEqual(handoverBatches(t, 7)[0][0].phone.slice(-1), "2");     // wraps round
  assert.equal(handoverBatches(Array.from({ length: 1201 }, () => ({})), 0).length, 3);
  assert.deepEqual(handoverBatches([], 3), []);
});

test("handoverReference fits NextSMS's reference rules", () => {
  const r = handoverReference("8f1c2d3e-4b5a-6978-8a9b-0c1d2e3f4a5b");
  assert.ok(r.length <= 50 && !/\s/.test(r));
  assert.match(r, /^nikadi-8f1c2d3e4b5a/);
});

test("scheduleControls: a schedule with NextSMS can't be edited, paused or cancelled while it holds sends", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  const server = { status: "active", sent_by: "server" };
  assert.deepEqual(scheduleControls(server, [], now), { edit: true, pause: true, resume: false, cancel: true, atNextsms: false });
  assert.equal(scheduleControls({ status: "paused" }, [], now).resume, true);
  const nx = { status: "active", sent_by: "nextsms" };
  const held = [{ status: "handed", run_at: "2026-11-09T06:00:00Z" }];
  assert.deepEqual(scheduleControls(nx, held, now), { edit: false, pause: false, resume: false, cancel: false, atNextsms: true });
  // nothing left at NextSMS (the hand-over failed, or every time has passed): it can be cancelled
  assert.equal(scheduleControls(nx, [{ status: "failed", run_at: "2026-11-09T06:00:00Z" }, { status: "handed", run_at: "2026-11-07T06:00:00Z" }], now).cancel, true);
  assert.equal(scheduleControls({ status: "done", sent_by: "nextsms" }, [], now).cancel, false);
});

test("handoverDetail and the With NextSMS badge", () => {
  assert.equal(handoverDetail({ accepted: 120, total: 122, failed: 2, reason: "UNDELIVERABLE", skippedNote: "3 skipped: 3 invalid numbers" }),
    "120/122 SMS accepted by NextSMS · 2 failed (UNDELIVERABLE) · 3 skipped: 3 invalid numbers");
  assert.equal(handoverDetail({ total: 0 }), "Nobody to send to");
  assert.equal(RUN_STATUS.handed.label, "With NextSMS");
});

test("providerErrorText keeps what NextSMS said", () => {
  assert.equal(providerErrorText(422, '{"message":"Duplicate request sent within past 24 hour(s)"}'), "HTTP 422: Duplicate request sent within past 24 hour(s)");
  assert.equal(providerErrorText(503, "  Service\n unavailable "), "HTTP 503: Service unavailable");
  assert.equal(providerErrorText(401, ""), "HTTP 401");
});

test("nextRun and the Schedules page count sends waiting at NextSMS until their time", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  const runs = [{ id: "a", status: "handed", run_at: "2026-11-08T09:00:00Z" }, { id: "b", status: "handed", run_at: "2026-11-08T12:00:00Z" }];
  assert.equal(nextRun(runs, now).id, "b");
  assert.equal(nextRun([{ status: "handed", run_at: "2026-11-01T09:00:00Z" }], now), null);
});

// ── NextSMS duplicate protection (same first message within 24 hours) ──
import { sendSmsMessages, isDuplicateRefusal } from "./messages.js";

const fakeProvider = (refuseFirstMulti = 1, singleStatus = 200) => {
  const calls = [];
  let multis = 0;
  const reply = (msgs) => JSON.stringify({ messages: msgs.map((m, i) => ({ to: m.to, messageId: `9${calls.length}${i}`, status: { groupId: 18, id: 51 } })) });
  const post = async (path, body) => {
    calls.push([path, body]);
    if (path === "/text/multi") {
      if (++multis <= refuseFirstMulti) return { status: 422, text: '{"message":"Duplicate request sent within past 24 hour(s)"}' };
      return { status: 200, text: reply(body.messages) };
    }
    return singleStatus === 200 ? { status: 200, text: reply([{ to: body.to }]) } : { status: singleStatus, text: '{"message":"Unauthenticated."}' };
  };
  return { post, calls };
};
const msgs = ["255712000001", "255712000002", "255712000003"].map(to => ({ from: "NIKADI", to, text: "Hi" }));

test("isDuplicateRefusal spots NextSMS's 24-hour duplicate refusal", () => {
  assert.equal(isDuplicateRefusal(422, '{"message":"Duplicate request sent within past 24 hour(s)"}'), true);
  assert.equal(isDuplicateRefusal(200, "Duplicate request"), false);
  assert.equal(isDuplicateRefusal(422, '{"message":"The from field is required."}'), false);
});

test("sendSmsMessages: no duplicate → one bulk request", async () => {
  const p = fakeProvider(0);
  const out = await sendSmsMessages(p.post, msgs, { date: "2026-11-09", time: "09:00" });
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0][1], { messages: msgs, flash: 0, date: "2026-11-09", time: "09:00" });
  assert.deepEqual([out.problem, out.problemFrom, out.answers.map(a => a.to)], ["", 3, ["255712000001", "255712000002", "255712000003"]]);
});

test("sendSmsMessages: a duplicate refusal sends the first message alone, then the rest", async () => {
  const p = fakeProvider(2);   // the first two bulk requests are refused (their first messages are recent)
  const out = await sendSmsMessages(p.post, msgs, { reference: "nikadi-x" });
  assert.deepEqual(p.calls.map(([path, b]) => [path, b.messages ? b.messages.map(m => m.to.slice(-1)) : b.to.slice(-1)]), [
    ["/text/multi", ["1", "2", "3"]], ["/text/single", "1"], ["/text/multi", ["2", "3"]], ["/text/single", "2"], ["/text/multi", ["3"]]]);
  assert.deepEqual(p.calls[1][1], { from: "NIKADI", to: "255712000001", text: "Hi", flash: 0, reference: "nikadi-x" });
  assert.equal(out.problem, "");
  assert.ok(out.answers.every(a => a && a.messageId));
});

test("sendSmsMessages: a refusal or no answer says from where, and whether they were sent", async () => {
  const refused = await sendSmsMessages(fakeProvider(1, 401).post, msgs);
  assert.deepEqual([refused.problem, refused.problemFrom, refused.refused], ["HTTP 401: Unauthenticated.", 0, true]);
  const down = await sendSmsMessages(async () => { throw new Error("network down"); }, msgs);
  assert.deepEqual([down.problem, down.problemFrom, down.refused], ["network down", 0, false]);
  const empty = await sendSmsMessages(fakeProvider(0).post, []);
  assert.deepEqual([empty.problem, empty.problemFrom], ["", 0]);
});

// ── Nikadi logo in the middle of card QR codes ──
import { qrLogoLayout, qrLogoCoverage, qrModules, qrPxPerModule, qrStyle, qrLogoMinSize, qrSizeForLogo, QR_LOGO_BOX, QR_MIN_PX_PER_MODULE } from "./qrLogo.js";

test("qrLogoLayout: a centred white square with clear space round the logo", () => {
  const { box, logo } = qrLogoLayout(100, 50, 200);
  assert.equal(box.side, 44);                                     // 22% of 200
  assert.deepEqual([box.x + box.side / 2, box.y + box.side / 2], [200, 150]);   // centred on the QR
  assert.ok(logo.x > box.x + 7 && logo.x + logo.w < box.x + box.side - 7);       // padding left and right
  assert.ok(logo.y > box.y + 7 && logo.y + logo.h < box.y + box.side - 7);       // and above and below
  assert.ok(Math.abs(logo.w / logo.h - 116 / 72) < 1e-9);                       // keeps its shape
  assert.ok(qrLogoCoverage() < 0.06 && QR_LOGO_BOX <= 0.25);                     // far inside what H repairs
});

test("qrModules follows the QR size tables for L and H", () => {
  assert.equal(qrModules("x".repeat(17), "L"), 21);      // version 1
  assert.equal(qrModules("x".repeat(18), "L"), 25);      // version 2
  assert.equal(qrModules("x".repeat(78), "H"), 49);      // a typical guest: version 8
  assert.equal(qrModules("x".repeat(114), "H"), 57);     // a long name: version 10
  assert.equal(qrModules("é".repeat(40), "H"), 49);      // counted in UTF-8 bytes (80)
  assert.equal(qrModules("x".repeat(3000), "L"), null);
});

test("qrStyle: the logo only where each square gets 3 px, else the plain code as before", () => {
  const guest = "ID=0f8fad5b-d9cb-469f-a165-70867728950e;Name=Asha Juma Mohamed;TypeCard=Double";   // 78 chars
  assert.equal(qrLogoMinSize(guest), 49 * QR_MIN_PX_PER_MODULE + 12);                            // 159
  assert.deepEqual(qrStyle(guest, 159), { ecc: "H", logo: true });
  assert.deepEqual(qrStyle(guest, 140), { ecc: "L", logo: false });
  assert.ok(qrPxPerModule(guest, 159) >= 3 && qrPxPerModule(guest, 158) < 3);
});

test("qrSizeForLogo: the size that gives every guest the logo (longest name, with an ID)", () => {
  const recs = [{ name: "Neema", cardType: "Single" }, { name: "Mheshimiwa Dkt. Abdallah Hamisi Kassimu Mwinyimkuu", cardType: "VIP Table" },
    { name: "Sample", sample: true }];
  assert.equal(qrSizeForLogo(recs), 57 * 3 + 12);     // the long name needs version 10 (57 modules)
  assert.ok(qrSizeForLogo([]) >= 150);                // no guests yet: a typical guest
});

// ── "Powered by Nikadi" footer on every card ──
import { footerLines, footerFontSize, cardFooterLayout, footerPill, boxesOverlap, snapFooterX, CARD_FOOTER_DEFAULTS } from "./cardFooter.js";

test("footerLines: from Settings, never empty", () => {
  assert.deepEqual(footerLines({}), [CARD_FOOTER_DEFAULTS.brand, CARD_FOOTER_DEFAULTS.phone]);
  assert.deepEqual(footerLines({ card_footer_brand: " Powered by Nikadi Events ", card_footer_phone: "+255 750 301 111" }), ["Powered by Nikadi Events", "+255 750 301 111"]);
  assert.deepEqual(footerLines({ card_footer_brand: "  ", card_footer_phone: null }), [CARD_FOOTER_DEFAULTS.brand, CARD_FOOTER_DEFAULTS.phone]);
  assert.equal(settingsFromRows([]).card_footer_brand, "Powered by Nikadi");
});

test("cardFooterLayout: a centred pill at the bottom, sized from the card width", () => {
  assert.deepEqual([footerFontSize(1080), footerFontSize(440), footerFontSize(4000)], [22, 9, 30]);
  const measure = (t) => t.length * 10;
  const L = cardFooterLayout(1080, 1350, ["Powered by Nikadi", "+255 750 301 1111"], measure);
  assert.ok(Math.abs(L.pill.x + L.pill.w / 2 - 540) <= 1, "centred");
  assert.ok(L.pill.y + L.pill.h < 1350 && L.pill.y + L.pill.h > 1350 - 30, "near the bottom edge");
  assert.deepEqual(footerPill(1080, 1350, { lines: ["Powered by Nikadi", "+255 750 301 1111"], pos: null }, measure), L.pill);
  assert.ok(L.lines[0].y < L.lines[1].y, "brand above the phone");
  assert.ok(L.mark.x + L.mark.w < L.lines[0].x, "the mark before the first line");
  assert.ok(L.mark.x >= L.pill.x && L.lines[0].x + measure(L.lines[0].text) <= L.pill.x + L.pill.w, "first line inside the pill");
  assert.equal(L.lines[1].align, "center");
});

// ── Card footer per event: text and colours ──
import { normaliseFooter, resolveFooter, hexToRgba, contrastRatio, footerHardToRead, FOOTER_STYLE_DEFAULTS, FOOTER_PRESETS } from "./cardFooter.js";

test("normaliseFooter keeps only good values", () => {
  assert.deepEqual(normaliseFooter({ brand: "Powered by Nikadi Events", phone: "+255 750 301 111", bg: "#B8860B", bgOpacity: 140, color: "#FFFFFF", extra: 1 }),
    { brand: "Powered by Nikadi Events", phone: "+255 750 301 111", bg: "#b8860b", bgOpacity: 100, color: "#ffffff" });
  assert.deepEqual(normaliseFooter({ bg: "red", color: "#12345", bgOpacity: "x" }), {});
  assert.deepEqual(normaliseFooter(null), {});
  assert.equal(normaliseFooter({ brand: "x".repeat(99) }).brand.length, 60);
  assert.equal(normaliseFooter({ bgOpacity: 0 }).bgOpacity, 0);
});

test("resolveFooter: the event's text and colours over the Settings defaults", () => {
  const settings = { card_footer_brand: "Powered by Nikadi", card_footer_phone: "+255 750 301 1111" };
  const d = resolveFooter(settings, null);
  assert.deepEqual(d.lines, ["Powered by Nikadi", "+255 750 301 1111"]);
  assert.equal(d.bg, "rgba(0,0,0,0.55)");
  assert.deepEqual(d.style, FOOTER_STYLE_DEFAULTS);
  const e = resolveFooter(settings, { brand: "Imeandaliwa na Nikadi", bg: "#ffffff", bgOpacity: 85, color: "#0d1f3c" });
  assert.deepEqual(e.lines, ["Imeandaliwa na Nikadi", "+255 750 301 1111"]);   // phone not changed → the default
  assert.equal(e.bg, "rgba(255,255,255,0.85)");
  assert.equal(e.color, "#0d1f3c");
  assert.deepEqual(resolveFooter(settings, { brand: "   ", phone: "" }).lines, d.lines);   // never empty
});

test("hexToRgba and readability", () => {
  assert.equal(hexToRgba("#b8860b", 90), "rgba(184,134,11,0.9)");
  assert.equal(hexToRgba("nope", 50), "rgba(0,0,0,0.5)");
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-9);
  assert.equal(footerHardToRead({ bg: "#ffffff", bgOpacity: 85, color: "#eeeeee" }), true);
  assert.equal(footerHardToRead({ bg: "#ffffff", bgOpacity: 10, color: "#eeeeee" }), false);   // barely any pill: the card shows through
  for (const p of FOOTER_PRESETS) assert.equal(footerHardToRead(p), false, `${p.label} reads well`);
});

// ── Card footer dragged anywhere on the card ──
test("the footer goes where it was dragged, and never off the card", () => {
  const measure = (t) => t.length * 10, lines = ["Powered by Nikadi", "+255 750 301 1111"];
  const top = cardFooterLayout(1080, 1350, lines, measure, { x: 0.5, y: 0.1 });
  assert.ok(Math.abs(top.pill.x + top.pill.w / 2 - 540) <= 1 && Math.abs(top.pill.y + top.pill.h / 2 - 135) <= 1, "centred where it was dropped");
  assert.ok(Math.abs(top.lines[1].x - 540) <= 1 && top.lines[0].y < top.lines[1].y, "the text moves with it");
  const corner = cardFooterLayout(1080, 1350, lines, measure, { x: 1, y: 1 });
  assert.deepEqual([corner.pill.x + corner.pill.w, corner.pill.y + corner.pill.h], [1080, 1350]);   // pushed back onto the card
  const left = cardFooterLayout(1080, 1350, lines, measure, { x: 0, y: 0 });
  assert.deepEqual([left.pill.x, left.pill.y], [0, 0]);
  assert.ok(left.mark.x >= 0);
});

test("the dragged position is saved as shares of the card, and snaps to the middle", () => {
  assert.deepEqual(normaliseFooter({ x: 0.123456, y: 0.9 }), { x: 0.1235, y: 0.9 });
  assert.deepEqual(normaliseFooter({ x: 2, y: -1 }), { x: 1, y: 0 });
  assert.deepEqual(normaliseFooter({ x: 0.5 }), {});                       // both or neither
  assert.deepEqual(normaliseFooter({ x: null, y: 0.4 }), {});
  assert.deepEqual(resolveFooter({}, { x: 0.3, y: 0.2 }).pos, { x: 0.3, y: 0.2 });
  assert.equal(resolveFooter({}, {}).pos, null);                           // bottom centre
  assert.deepEqual([snapFooterX(0.49), snapFooterX(0.51), snapFooterX(0.47)], [0.5, 0.5, 0.47]);
});

test("boxesOverlap finds a QR under the footer", () => {
  const pill = { x: 400, y: 1250, w: 280, h: 70 };
  assert.equal(boxesOverlap({ x: 440, y: 1100, w: 200, h: 200 }, pill), true);
  assert.equal(boxesOverlap({ x: 440, y: 900, w: 200, h: 200 }, pill), false);
  assert.equal(boxesOverlap({ x: 0, y: 1250, w: 400, h: 70 }, pill), false);   // touching edges only
  assert.equal(boxesOverlap(null, pill), false);
});

// ── Card footer size ──
import { FOOTER_SIZE, stepFooterSize } from "./cardFooter.js";

test("the footer's size: saved in range, − / + in 10% steps", () => {
  assert.equal(normaliseFooter({ scale: 1.234 }).scale, 1.23);
  assert.deepEqual([normaliseFooter({ scale: 9 }).scale, normaliseFooter({ scale: 0.1 }).scale], [FOOTER_SIZE.max, FOOTER_SIZE.min]);
  assert.equal(normaliseFooter({ scale: "" }).scale, undefined);
  assert.equal(resolveFooter({}, {}).scale, 1);
  assert.equal(resolveFooter({}, { scale: 1.5 }).scale, 1.5);
  assert.deepEqual([stepFooterSize(1, 1), stepFooterSize(1, -1), stepFooterSize(0.7, 1)], [1.1, 0.9, 0.8]);   // no float noise
  assert.deepEqual([stepFooterSize(FOOTER_SIZE.max, 1), stepFooterSize(FOOTER_SIZE.min, -1)], [FOOTER_SIZE.max, FOOTER_SIZE.min]);
});

test("a bigger footer grows its text and pill, and still stays on the card", () => {
  const measure = (t, font) => t.length * Number(/(\d+)px/.exec(font)[1]) * 0.5, lines = ["Powered by Nikadi", "+255 750 301 1111"];
  const normal = cardFooterLayout(1080, 1350, lines, measure, null, 1);
  const big = cardFooterLayout(1080, 1350, lines, measure, null, 2);
  const small = cardFooterLayout(1080, 1350, lines, measure, null, 0.5);
  assert.deepEqual([small.fontSize, normal.fontSize, big.fontSize], [11, 22, 44]);
  assert.ok(big.pill.w > normal.pill.w * 1.9 && big.pill.h > normal.pill.h * 1.9);
  assert.ok(big.mark.h > normal.mark.h * 1.9, "the mark grows too");
  assert.equal(big.pill.y + big.pill.h < 1350, true);                                  // bottom centre: still on the card
  const corner = cardFooterLayout(1080, 1350, lines, measure, { x: 1, y: 1 }, FOOTER_SIZE.max);
  assert.deepEqual([corner.pill.x + corner.pill.w, corner.pill.y + corner.pill.h], [1080, 1350]);
  assert.deepEqual(footerPill(1080, 1350, { lines, pos: null, scale: 2 }, measure), big.pill);
});

// ── Card fonts: Ubuntu, Outfit (Google), Aptos, Ananda (device / uploaded) ──
import { CARD_FONTS, GOOGLE_FONTS_URL, cardFontOptions, uploadedFonts, missingCardFonts, validateFontUpload, fontFilePath, familyFromFileName } from "./fonts.js";

test("the four new fonts are offered; Ubuntu and Outfit load from Google Fonts", () => {
  const by = Object.fromEntries(CARD_FONTS.map(f => [f.value, f.source]));
  assert.deepEqual([by.Ubuntu, by.Outfit, by.Aptos, by.Ananda], ["google", "google", "device", "device"]);
  assert.match(GOOGLE_FONTS_URL, /family=Ubuntu:/);
  assert.match(GOOGLE_FONTS_URL, /family=Outfit:/);
  for (const f of CARD_FONTS.filter(x => x.source === "google")) assert.ok(GOOGLE_FONTS_URL.includes(`family=${f.value.replace(/ /g, "+")}:`), `${f.value} is loaded`);
});

test("uploaded fonts: cleaned, added to the list, and an uploaded Aptos counts as available", () => {
  const up = [{ family: " Aptos ", url: "https://x.supabase.co/storage/v1/object/public/fonts/aptos-1.ttf" },
    { family: "My Script", url: "https://x/f.woff2" }, { family: "Bad", url: "javascript:x" }, null];
  assert.deepEqual(uploadedFonts(up).map(f => f.family), ["Aptos", "My Script"]);
  const opts = cardFontOptions(up);
  assert.equal(opts.find(o => o.value === "Aptos").source, "uploaded");
  assert.equal(opts.find(o => o.value === "My Script").source, "uploaded");
  assert.equal(opts.find(o => o.value === "Ananda").source, "device");
  const notInstalled = () => false;
  assert.deepEqual(missingCardFonts(["Ubuntu", "Aptos", "Ananda", "Ananda"], up, notInstalled), ["Ananda"]);   // Google fonts and uploaded ones are fine
  assert.deepEqual(missingCardFonts(["Ananda"], [], () => true), []);                                           // installed on this computer
});

test("validateFontUpload and the stored file name", () => {
  assert.deepEqual(validateFontUpload({ family: "Aptos", fileName: "Aptos.ttf", size: 300000 }), { errors: {}, ext: "ttf" });
  assert.match(validateFontUpload({ family: "", fileName: "x.ttf", size: 1 }).errors.family, /name/);
  assert.match(validateFontUpload({ family: "A", fileName: "x.zip", size: 1 }).errors.file, /\.ttf/);
  assert.match(validateFontUpload({ family: "A", fileName: "x.woff2", size: 6e6 }).errors.file, /5 MB/);
  assert.match(validateFontUpload({ family: "A;drop", fileName: "x.ttf", size: 1 }).errors.family, /letters/);
  assert.match(validateFontUpload({ family: "aptos", fileName: "a.otf", size: 1 }, [{ family: "Aptos", url: "https://x" }]).errors.family, /already/);
  assert.equal(fontFilePath("Ananda Script!", "ttf", 123), "ananda-script-123.ttf");
  assert.deepEqual(["Aptos-Regular.ttf", "Ananda_Regular.otf", "OutfitBold.woff2", "MyFont.ttf"].map(familyFromFileName), ["Aptos", "Ananda", "Outfit", "My Font"]);
});

test("the footer has its own font", () => {
  assert.equal(resolveFooter({}, { font: "Outfit" }).font, "Outfit");
  assert.equal(resolveFooter({}, {}).font, "Plus Jakarta Sans");
  assert.deepEqual(normaliseFooter({ font: "x'); alert(1" }), {});
  const L = cardFooterLayout(1080, 1350, ["Powered by Nikadi", "+255"], (t) => t.length * 10, null, 1, "Ubuntu");
  assert.ok(L.lines.every(l => l.font.includes("'Ubuntu', sans-serif")));
  // a font without real numbers: the phone line keeps the normal font
  const P = cardFooterLayout(1080, 1350, ["Powered by Nikadi", "+255"], (t) => t.length * 10, null, 1, "Ananda", "Plus Jakarta Sans");
  assert.ok(P.lines[0].font.includes("'Ananda'") && P.lines[1].font.includes("'Plus Jakarta Sans'"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, isValidPhone } from "./phone.js";
import { selectRecipients, dropDuplicates, describeSkipped } from "./recipients.js";
import { fillTemplate, normaliseSheetRows, recipientKey, applyMessageStatuses, sanitiseMessages } from "./messages.js";

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

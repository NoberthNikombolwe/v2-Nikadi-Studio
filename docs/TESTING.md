# Nikadi Studio — Testing Guide (Including Red Team & QA)

**Last updated:** 2026-11-16

---

## 1. Testing Strategy Overview

| Layer | Method | Location | Runs in CI? |
|-------|--------|----------|------------|
| Pure logic | Node.js unit tests | `src/lib/lib.test.js` | Yes |
| Edge Functions | Node.js integration tests | `supabase/functions/**/*.test.ts` | Yes |
| Build | `npm run build` | Vite | Yes |
| Linting | ESLint | `.eslintrc` | Yes |
| UI / full flow | Manual in browser | `npm run dev` | No |
| Security | Manual red team audit | This document | No |

There are no automated UI/component tests. `App.jsx` is verified by hand.

---

## 2. Unit Tests

### 2.1 Running

```bash
cd studio
npm test
# Uses Node.js built-in test runner (node:test) — no Jest, no Vitest needed
```

### 2.2 Location

`studio/src/lib/lib.test.js`

This file tests all exported functions from `src/lib/`:
- `normalisePhone`, `isValidPhone`
- `fillTemplate`, `normaliseSheetRows`
- `selectRecipients`, `describeSkipped`
- `planCardSave`, `splitImport`, `resetSendStatuses`
- Finance, CRM, schedule helpers

### 2.3 Writing a New Test

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { myFunction } from "./myModule.js";

describe("myFunction", () => {
  it("handles normal input", () => {
    assert.strictEqual(myFunction("input"), "expected");
  });

  it("handles edge case", () => {
    assert.deepStrictEqual(myFunction(null), []);
  });
});
```

**Rules:**
- Test every exported function in `src/lib/`
- Test boundary conditions (null, empty string, missing fields)
- No network calls, no Supabase, no browser APIs in unit tests

---

## 3. Edge Function Tests

### 3.1 Running

```bash
cd studio
npm run test:functions
# Requires Node.js 22+
# Mocks Deno and fetch — no real HTTP calls
```

### 3.2 Location

`supabase/functions/**/*.test.ts` (TypeScript, run via Node.js)

Tests cover:
- `send-sms` and `send-wa` proxy functions (request forwarding, token injection, endpoint allowlisting)
- `run-schedules` function (schedule processing, delivery polling logic)
- `_shared/messaging.js` helpers

### 3.3 What Gets Mocked

```ts
// The test framework mocks:
// - globalThis.Deno (Deno environment)
// - globalThis.fetch (HTTP calls)
// - Supabase client
// So tests run in Node.js without a real Supabase or provider connection
```

---

## 4. Manual QA Checklist

Run this checklist after any significant change before merging to `main`:

### 4.1 Authentication

- [ ] Sign in with a valid invited email → lands on the app
- [ ] Sign in with a non-invited email → shows "Access denied" / sign-in fails
- [ ] Sign out → returns to login page
- [ ] Session survives page refresh
- [ ] Inactive user (`app_users.active = false`) cannot sign in

### 4.2 Event Lifecycle

- [ ] Create a new event → appears in Events tab
- [ ] Edit event details → saved correctly
- [ ] Enable guest_link_enabled toggle → "Guest Links" and "Manage Page" buttons appear
- [ ] Disable guest_link_enabled → buttons disappear
- [ ] Delete event (as Super Admin) → event and all cards deleted

### 4.3 Guest Import

- [ ] Import a valid `.xlsx` file → guests appear in Contacts
- [ ] Import with duplicate names+phones → duplicates skipped
- [ ] Re-import same file → no double entries
- [ ] Import updates card type for a name+phone match

### 4.4 Card Designer

- [ ] Upload a background template image
- [ ] Drag all element types (name, cardtype, date, QR, logo, footer)
- [ ] Export a card as JPEG → downloads correctly
- [ ] Card shows correct guest name from the contacts list
- [ ] QR code is scannable in the Scanner tab

### 4.5 SMS

- [ ] Preview SMS shows correct personalised text for selected guest
- [ ] SMS with `{name}` and `{cardType}` → placeholders filled correctly
- [ ] Guest link appended to SMS when `guest_link_enabled = true`
- [ ] Guest link NOT present when `guest_link_enabled = false`
- [ ] Send SMS to one guest → delivery confirmation received
- [ ] Scheduled SMS → fires at the correct time

### 4.6 WhatsApp

- [ ] Send a card via WhatsApp → message received with card image
- [ ] Delivery status updates from "sent" to "delivered"
- [ ] Bulk send to all guests completes without error

### 4.7 Guest Microsite

- [ ] Open guest link in incognito → page loads with correct guest data
- [ ] Countdown timer counts down correctly
- [ ] Download card button downloads the card JPEG
- [ ] RSVP form submits → "Asante!" confirmation shown
- [ ] Map appears with venue location when lat/lng set
- [ ] Satellite toggle works on the map
- [ ] "Get Directions" opens Google Maps
- [ ] Invalid link → "Link not found" page
- [ ] Link for event with `guest_link_enabled = false` → "Link not found"

### 4.8 Scanner

- [ ] Scanner page requires the scan code
- [ ] Valid QR scan → guest marked as arrived
- [ ] Double-scan → "Already checked in" message
- [ ] Scan log appears in real-time across two open tabs
- [ ] View-only report page requires the view code

### 4.9 Finance

- [ ] Add an income transaction → appears in the event P&L
- [ ] Add an expense transaction → deducted from P&L
- [ ] Delete transaction (Super Admin only) → removed
- [ ] Non-Super Admin cannot see delete button on transactions

### 4.10 Roles & Permissions

- [ ] Log in as each role and verify the correct tabs are visible
- [ ] `finance_officer` cannot see Design, SMS, or WhatsApp tabs
- [ ] `graphics_designer` cannot see Finance tab
- [ ] `help_desk` cannot see Leads or Customers tabs
- [ ] Only `superuser` sees delete buttons

---

## 5. Red Team Security Testing (Claude-Assisted)

This section documents security attacks that were considered and the mitigations in place.

### 5.1 Authentication Bypasses

**Attack:** Directly calling Supabase REST API as `anon` to read events.

```bash
curl https://xxxxxxxxxxx.supabase.co/rest/v1/events \
  -H "apikey: <anon_key>" \
  -H "Authorization: Bearer <anon_key>"
```

**Expected result:** Empty array or 403 — no data returned.  
**Mitigation:** RLS policies only allow `authenticated` role; `anon` has zero access.  
**Test:** Run the above curl and verify an empty response.

---

**Attack:** Forge a JWT to access data as a different user.

**Expected result:** Invalid signature → rejected by Supabase.  
**Mitigation:** Supabase verifies JWT signatures with the project's JWT secret.

---

**Attack:** Sign in with an email not in `app_users`.

**Expected result:** Sign-in rejected.  
**Mitigation:** Database trigger `trg_fn_check_app_user` raises an exception; Supabase returns 400.

---

### 5.2 Public Page Data Exposure

**Attack:** Call `public_event_page_data` for a valid event and inspect the response for sensitive data.

```js
const { data } = await supabase.rpc("public_event_page_data", {
  p_event_public_id: "ABC12345",
  p_guest_public_id: "XYZ67890"
});
console.log(data);
```

**Expected result:** Only `event_name`, `event_type`, `start_datetime`, `end_datetime`, `venue_name`, `venue_address`, `page_settings`, `guest_name`, `card_type`, `card_url`, `card_code`.  
**NOT returned:** Phone numbers, email addresses, `event_cards.id`, `events.id`.  
**Mitigation:** RPC uses `jsonb_build_object` to explicitly select only safe fields.

---

**Attack:** Call the guest RPC with a guessed public ID.

**Expected result:** Null returned — wrong ID → no data.  
**Mitigation:** 8-char IDs from a 32-char charset = 32^8 ≈ 1 trillion combinations. Brute-force is impractical.

---

**Attack:** Call the guest RPC for an event with `guest_link_enabled = false`.

**Expected result:** Null returned.  
**Mitigation:** RPC includes `AND guest_link_enabled = TRUE` guard.

---

### 5.3 Data Manipulation via Public RPCs

**Attack:** Use `submit_rsvp` to submit many RSVPs from the same guest.

**Expected result:** Multiple rows inserted — there is currently no deduplication per guest.  
**Mitigation (current):** RSVPs are low-stakes data; the admin reviews them. The table has no unique constraint per guest.  
**Recommended hardening:** Add a `UNIQUE (event_id, card_id)` constraint and use `ON CONFLICT DO UPDATE` in `submit_rsvp`.

---

**Attack:** Use `submit_rsvp` to submit for a valid event but a random/non-existent guest ID.

**Expected result:** Row inserted with `card_id = NULL`.  
**Mitigation:** The RPC does a best-effort lookup for the card; if not found, `card_id` is NULL but the RSVP is still recorded (since it may be a legitimate RSVP from a guest whose card was later deleted).

---

### 5.4 SMS Injection

**Attack:** Create a guest with a name containing `\n` or special characters to manipulate SMS content.

**Input:** Guest name = `Juma\nPAYMENT REQUIRED: 1000 TZS`

**Expected result:** `\n` appears as a literal newline in the SMS, which is valid but not exploitable.  
**Mitigation:** SMS templates are plain text. There is no HTML rendering or command execution. The newline is visible but harmless.

---

**Attack:** Send an SMS to `+1234567890` (non-Tanzanian number) by editing the phone in a guest record.

**Expected result:** The provider accepts or rejects it based on its own country rules.  
**Mitigation:** `normalisePhone()` accepts international formats. This is a provider-side policy, not an app-side block. If restriction is needed, add a country code allowlist to `isValidPhone()`.

---

### 5.5 Storage Bucket Access

**Attack:** Access `templates` bucket files without authentication.

```bash
curl https://xxxxxxxxxxx.supabase.co/storage/v1/object/templates/my-template.jpg
```

**Expected result:** 400 or 403 — bucket is not public.  
**Mitigation:** `templates` and `fonts` buckets are private; only authenticated users can access them.

---

**Attack:** Upload a malicious file to the `event-pages` bucket by guessing a path.

```bash
curl -X POST "https://xxxxxxxxxxx.supabase.co/storage/v1/object/event-pages/../../etc/passwd" \
  -H "Authorization: Bearer <anon_key>" \
  --data-binary @malicious.php
```

**Expected result:** Rejected — anon has no INSERT on storage; Supabase sanitises paths.  
**Mitigation:** Supabase Storage uses path sanitisation; bucket policies require `authenticated` for INSERT.

---

### 5.6 XSS Attacks

**Attack:** Create a guest with a name containing HTML tags.

**Input:** Guest name = `<img src=x onerror="alert(1)">`

**Expected result:** Name appears as literal text — no script execution.  
**Mitigation:** React escapes all text content by default. No `dangerouslySetInnerHTML` is used for user data.

---

**Attack:** Inject a script via an SMS template placeholder.

**Input:** Template = `Habari {name}!`, guest name = `<script>alert(1)</script>`

**Expected result:** SMS is delivered as plain text. No HTML rendering.  
**Mitigation:** SMS is plain text. No HTML rendering occurs.

---

### 5.7 SQL Injection

**Attack:** Inject SQL via a guest's name or phone in an import.

**Input:** Name = `'; DROP TABLE event_cards; --`

**Expected result:** Name stored as a literal string.  
**Mitigation:** The Supabase JS client uses parameterised queries. String values are never interpolated into SQL. RPCs use `$1, $2` parameters.

---

### 5.8 Provider Token Leakage

**Attack:** Inspect the browser's network requests to find the SMS provider Bearer token.

**Expected result:** Network requests in production only show the Supabase JWT (Bearer). The provider token is never sent from the browser.  
**Mitigation:** Production sends go through Edge Functions which inject the provider token server-side. The browser never sees it.

**Test:** In production, open DevTools → Network → filter by `/functions/v1/send-sms`. Verify the Authorization header contains only the Supabase JWT (starts with `eyJhbGc...`), not the provider token.

---

## 6. Performance Testing

### 6.1 Large Guest List

Test with 1 000 guests imported from a spreadsheet:
- Import time should be < 10 seconds
- Table rendering should not stall the UI (cards are rendered in a virtualised-enough fashion)
- Bulk SMS send should batch correctly (provider rate limits)

### 6.2 Card Rendering

Test with high-resolution template (2 000 × 2 000 px):
- Card export should complete in < 3 seconds per card
- Bulk export of 100 cards should not crash the tab

---

## 7. Regression Testing

After every feature change, re-run the core user journey:

```
Create event → Import 10 guests → Design a card →
Export 1 card → Send 1 SMS (preview it first) →
Enable guest links → Open guest link in incognito →
Verify card shows correctly
```

This 5-minute test covers the most critical path and catches most regressions.

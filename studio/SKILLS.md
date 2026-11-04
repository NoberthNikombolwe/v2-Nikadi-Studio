# SKILLS.md

Repeatable recipes for common changes in Nikadi Studio. Each skill lists what to touch, in order, and how to check it worked. Project background and conventions are in [CLAUDE.md](CLAUDE.md).

Everything below is in [src/App.jsx](src/App.jsx) unless noted. Search for the named function/identifier rather than relying on line numbers — they drift.

**Always finish with:** `npm run lint`, `npm test`, `npm run build` (plus `npm run test:functions` if you touched `supabase/functions`), then try the change in `npm run dev`.

---

## 1. Add a per-row action button to a records table

Used for the Upload / WA / SMS / PNG buttons on the Batch & Send tab (`RecordRow`) and the Upload / Send buttons on the WhatsApp tab.

1. Write the handler inside `<App>` as `async (idx) => {...}` that reads `records[idx]`. If it can throw, wrap it so the user sees a toast (see `uploadCardWithToast`) — table rows have no log to report into.
2. **Batch & Send tab:** add an `onXxx` prop to `RecordRow`'s signature, render a `<Sb bg=… col=… onClick={()=>onXxx(idx)}>` in its Actions cell, and pass the handler where `<RecordRow … />` is rendered.
   **WhatsApp tab:** the table is inline in `<App>` — add the `<Sb>` directly in the Actions `<td>`.
3. Reflect progress on the button itself: `disabled` while busy, ⏳ icon while running, ✓ once done (see the Upload button).
4. If the action needs a field on the record, initialise it everywhere records are created (`sampleRecords`, `onExcelUpload`, loading an event's `event_cards` in `selectEvent`) — grep for `uploadStatus:` to find those spots.

## 2. Upload a rendered card to Supabase Storage (Step 1 of WhatsApp sending)

Handled by `uploadCardSingle(idx)`: `exportCard` → `compressCard` (JPEG, ≤ ~2.8 MB, ≤ 1200 px wide) → `supabase.storage.from("wa-cards").upload(...)` → store the public URL in `record.cardUrl`. Any failure (render, QR/template load, compression, Storage) marks the row `"failed"` and rethrows.

- Bulk: `uploadAllCards()` (WhatsApp tab "Upload All Cards", progress in `uploadLog`).
- Single from the Batch tab: `uploadCardWithToast(idx)`.
- Prerequisite: run `supabase-schema.sql` — it creates the public `wa-cards` bucket (5 MB, `image/jpeg` only, sign-in-only uploads).
- Remember `cardUrl`/`uploadStatus` are not persisted to the database.

## 3. Send a WhatsApp card

`sendWaSingle(idx)` requires `rec.phone` (valid), `rec.cardUrl` and a selected `waTemplate`; it ignores a row that is already `sending` and asks before re-sending to one that is `sent`. It POSTs `{ to, account:"Nikadi", template, header:{ image:{ file: cardUrl, name } } }` to `${WA_BASE}/api/whatsapp/v2/text/single` (bearer from `getApiToken("wa")`) and maps the provider's `groupId`/`id` codes to `WA.sent | WA.invalid | WA.notSent`. A `pending` (groupId 18) response starts `pollWaStatus` to catch late rejections.

`sendWaAll` uses `selectRecipients` (skips sent / invalid / duplicate / card-less contacts), confirms with the user, sends with a 1 s gap, then saves with `saveCards(id, recordsRef.current)`.

To add a template: add its name to the `["Mwaliko","Mchango","ImageTemp"]` button list in the WhatsApp tab (users can also type a custom name). The template itself must already exist/be approved in messaging-service.co.tz.

## 4. Send an SMS

`sendSmsToOne(idx, msgId = MAIN_MSG)` (single; in-flight guard + confirm on re-send) and `sendAllSms(msgId = MAIN_MSG)` (bulk via `pickBulkRecipients({ …, recs })`, confirm, then results mapped back by normalised phone and saved). `msgId` picks the main message or an extra one; `idx` indexes that message's `messageRecipients(msg)` list, and results go through `setMessageStatuses`. Extra messages (reminder, thank-you…) live in `extraMessages` / `events.sms_messages` and choose their recipients: the event contacts or an uploaded list (`onMessageListUpload`, or the VCard tab list via `setMessageList`). Message text comes from `smsMessage` with `{name}` / `{cardType}` filled by `buildSmsMsg` (every occurrence is replaced). The template is saved per event to `events.sms_message` (manual save button). Endpoints are under `${SMS_API}/…` — `/text/single`, `/text/multi`, plus `${SMS_BASE}/api/v2/balance`; the bearer comes from `getApiToken("sms")`.

## 5. Add or change a tab

1. Add a button in `<nav className="nk-tabs">` with `className={`nk-tab${tab==="id"?" active":""}`}` and `onClick={()=>setTab("id")}`.
2. Add a `{tab === "id" && (...)}` block in `<main>`. Wrap in `<div className="nk-page">` like the others.
3. Optional info banner: add a `{tab==="id" && <div className="nk-banner">…</div>}` above `nk-body`.
4. Update the section list in the file's header comment and the Features section of README.md.

## 6. Add a card design element

1. Add the element to `defaultElements()` (id, type `text`/`qr`/…, x/y, size, colour).
2. Teach `CardCanvas` (preview) and `exportCard` (rasteriser) to draw it — they must stay in sync or the preview won't match the export. In `exportCard`, load any images up front (`loadImage`) so a failure rejects instead of producing a half-drawn card.
3. Add property controls in the right sidebar (`selectedEl?.type===…` blocks) if it needs any.
4. If it should be hidden for some event types, extend the `isMichango` pattern (`designElements` filter and the element-list rendering).
5. Layouts auto-save to localStorage (`nikadi_layout_*`) and persist to `events.elements_layout` — older saved layouts won't contain the new element, so check the restore path handles that.

## 7. Add a Supabase table, column or bucket

1. Edit [supabase-schema.sql](supabase-schema.sql) using the existing idempotent style (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` then `CREATE POLICY`). The file must stay safe to re-run.
2. **RLS:** enable it and grant `TO authenticated` only. Never grant to `anon` or `public` — the anon key ships in the browser bundle.
3. Update the "Database Tables" section of README.md and the Supabase table in CLAUDE.md.
4. Wire reads/writes in `<App>` with `supabase.from("…")`, always guarding `if (!supabase)` and surfacing `error.message` through `showToast(..., "warn")`.
5. Buckets: set `file_size_limit` and `allowed_mime_types`; make them public only if an external service must fetch the URL (e.g. the WhatsApp provider), and add `authenticated`-only INSERT/SELECT policies.

## 8. Import contacts from Excel / CSV

`onExcelUpload` lazy-loads SheetJS (`loadXlsx()`), normalises headers to `name`, `cardType`, `phone`, and seeds each record with `waStatus: WA.idle, smsStatus: SMS.pending, cardUrl: null, uploadStatus: "idle"`. The VCard tab has its own parser, `onVcardCsvUpload` (name + phone only). New columns: extend the normalisation in `onExcelUpload`, then `saveCards` and the `event_cards` load path in `selectEvent` if it must persist.

Phone cells: Excel drops leading zeros from numeric cells, which is why `normalisePhone` also accepts the bare 9-digit form (`712345678` → `255712345678`). Add cases to `src/lib/lib.test.js` before changing it.

## 9. Change or deploy the messaging Edge Functions

Source: [send-sms](supabase/functions/send-sms/index.ts) and [send-wa](supabase/functions/send-wa/index.ts), both built on [_shared/proxy.ts](supabase/functions/_shared/proxy.ts). Security properties that must not regress (each has a test in `proxy.test.ts`): sign-in required, endpoint+method allowlist, server-side provider token, generic upstream errors, body size cap.

- **Add a provider endpoint:** add `{ method, path }` to that function's `routes`, add a test, then use it from the client via `SMS_BASE`/`WA_BASE` + `getApiToken(...)`. Don't widen the allowlist to prefixes or wildcards.
- **Add a new proxy:** copy `send-wa/index.ts`, change `name`, `tokenEnv` and `routes`, add a dev proxy in `vite.config.js`.
- **Test:** `npm run test:functions` (Node ≥ 22.18; no Deno needed).
- **Deploy** (see README Step 8): `npx supabase secrets set SMS_BEARER_TOKEN=… [WA_BEARER_TOKEN=…] [ALLOWED_ORIGINS=…] --project-ref <ref>`, then `npx supabase functions deploy send-sms --no-verify-jwt --project-ref <ref>` (and `send-wa`). `--no-verify-jwt` is deliberate — the function does its own, stricter user check.
- After deploying, confirm a signed-out `curl` returns 401.

## 10. Rotate or add an environment variable

1. Add it to `.env.local` (public values only) or `.env.development.local` (dev-only secrets) and to [.env.example](.env.example) (placeholder value only) and the README's Step 4.
2. Read it via `import.meta.env.VITE_…`; remember `VITE_*` values present at build time ship in the browser bundle, so anything secret belongs in an Edge Function secret instead.
3. Restart `npm run dev` — Vite only reads env files at startup.
4. **Rotating a provider token:** generate a new one with the provider, update `.env.development.local` and the Supabase secret (`supabase secrets set …`), redeploy is not needed for secrets, then revoke the old token.

## 11. Add a bulk action that messages or charges people

1. Pick recipients with `await pickBulkRecipients({ title, emptyMsg, options: { isDone, isEligible } })` (a thin UI wrapper over `selectRecipients`) — never `records.filter(r => r.phone)`. It shows the in-app modal with the recipient count, the skipped summary and, if contacts share a number, the "Send without duplicates" / "Send duplicates too" choice.
2. Return early when it resolves to `null` (nothing to send, or the user cancelled). Never use `window.confirm` — for a one-off question use `askDialog({ title, body, actions })`, which resolves with the clicked action's `value` or `null`.
3. Guard re-entry (`if (busy) return`), pace requests, and don't log phone numbers.
4. Persist with `saveCards(eventId, <latest records>)` — use `recordsRef.current` or a locally computed list, not the closure's `records`.

## 12. Pre-commit checklist

- [ ] `npm run lint`, `npm test`, `npm run build` pass (and `npm run test:functions` if edge code changed)
- [ ] No tokens, keys or phone numbers in the diff (`git diff --cached | grep -iE "bearer|eyJ|sb_"`)
- [ ] `grep` the fresh `dist/` for the provider token prefix — it must not appear
- [ ] New functions have a short `//` comment in the file's existing style
- [ ] README / CLAUDE.md / `supabase-schema.sql` updated if behaviour, env vars or schema changed

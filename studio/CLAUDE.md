# CLAUDE.md

Guidance for Claude Code when working in this repo. For setup/deploy walkthroughs see [README.md](README.md); for step-by-step recipes for common changes see [SKILLS.md](SKILLS.md).

## What this is

Nikadi Studio — an internal React tool for designing personalised event invitation cards (background image + draggable name/QR/date/logo elements), importing contacts from Excel/CSV, and distributing the rendered cards by WhatsApp, SMS and VCard. Events, contacts and templates persist to Supabase. Messaging goes through messaging-service.co.tz.

The git root is one level above this folder (`v1-Nikadi-Studio/`); everything lives in `studio/`. Run all commands from `studio/`.

## Commands

```bash
npm run dev             # Vite dev server on :5173 (with /sms-proxy and /wa-proxy → messaging-service.co.tz)
npm run build           # production build to dist/
npm run lint            # eslint .
npm test                # unit tests for src/lib (node:test, no extra deps)
npm run test:functions  # Edge Function proxy tests (needs Node ≥ 22.18; mocks Deno + fetch)
npm run preview         # serve the production build
```

Before finishing a change run `npm run lint`, `npm test`, `npm run test:functions` (if you touched `supabase/functions`) and `npm run build`, then exercise the UI in `npm run dev`. There are no component/UI tests — `App.jsx` is verified by hand.

## Architecture

- **Single-file UI.** The UI and state are in [src/App.jsx](src/App.jsx) (~2.8k lines): CSS-in-JS string, `<CardCanvas>`, `exportCard()`, `<EventModal>`, row components, and the default-exported `<App>` which owns all state and renders every tab. The header comment lists the file's sections top to bottom. Don't split it up unless asked.
- **Pure logic lives in `src/lib/` and is unit-tested:** [phone.js](src/lib/phone.js) (`normalisePhone`, `isValidPhone`), [recipients.js](src/lib/recipients.js) (`selectRecipients`, `describeSkipped` — who a bulk send goes to), [messages.js](src/lib/messages.js) (`fillTemplate`, `normaliseSheetRows`, per-message SMS status helpers), [supabase.js](src/lib/supabase.js) (client; exports `null` when env vars are missing, so guard with `if (!supabase)`). New non-UI logic belongs here with a test in `lib.test.js`.
- Other files: [src/LoginPage.jsx](src/LoginPage.jsx) (Google sign-in gate shown until a session resolves), [src/main.jsx](src/main.jsx).
- **Tabs** (`tab` state, rendered in `<nav className="nk-tabs">`): `events`, `design`, `vcard`, `sms`, `whatsapp`, `batch` ("Batch & Send"), `reports`. Each tab body is a `{tab === "..." && (...)}` block in `<App>`'s JSX. `selectEvent(ev, targetTab = "design")` loads an event and then switches to `targetTab` (pass `"reports"` for the Report shortcut, `null` to stay put); clicking an Events-table row opens it in Design.
- **Records** — the contact list is the `records` array in `<App>` state: `{ dbId?, name, cardType, phone, waStatus, smsStatus, cardUrl, uploadStatus, sample?, ...extra spreadsheet columns }`. `dbId` is the row's `event_cards.id` (set by `saveCards`/`selectEvent`); `autoSaveCard(dbId, wa, sms)` uses it to persist a single card's status right after each send. Status values come from the `WA` / `SMS` constants near the top of the file. `uploadStatus` is `"idle" | "uploading" | "uploaded" | "failed"`. `sample: true` marks placeholder rows from `sampleRecords()` (no phone; never saved).
- **Card rendering** — `designElements` (the layout) + a record are rasterised by `exportCard()` for download/zip/upload. It is async and **rejects** if the template or a QR image fails to load (never produces a card with a missing QR). Michango events hide the `qr` and `cardtype` elements (`isMichango`).
- **Messaging proxies** — `SMS_BASE` / `WA_BASE` point at the Vite proxy in dev (`import.meta.env.DEV`) and at the Supabase Edge Functions [send-sms](supabase/functions/send-sms/index.ts) / [send-wa](supabase/functions/send-wa/index.ts) in production. Both are thin wrappers over [_shared/proxy.ts](supabase/functions/_shared/proxy.ts), which requires a signed-in Supabase user, allowlists specific provider endpoints, and injects the provider token from a server-side secret. Client code gets its bearer token from `getApiToken("sms" | "wa")`: the provider token in dev, the user's session access token in production.
- **Heavy libs are lazy** — `xlsx` and `jszip` are npm packages loaded on demand via `loadXlsx()` / `loadJsZip()` (keeps them out of the initial bundle; nothing is fetched from a CDN at runtime). `xlsx` is pinned to SheetJS's own patched tarball (0.20.3) because the npm registry copy (0.18.5) has known vulnerabilities.

### Supabase

| Thing | Name | Used for |
|---|---|---|
| Table | `events` | event details, `elements_layout` JSON, `sms_message`/`sms_draft` (main SMS), `sms_messages` JSON (extra SMS messages) |
| Table | `event_cards` | one row per contact (`name, card_type, phone, wa_status, sms_status`) |
| Table | `saved_templates` | reusable background + layout |
| Bucket | `templates` | template/background images |
| Bucket | `wa-cards` | per-contact rendered card JPEGs for WhatsApp (must stay public) |

Schema, RLS and bucket setup live in [supabase-schema.sql](supabase-schema.sql) (idempotent). RLS is **signed-in users only** — never add `anon` policies for these tables or buckets; the anon key is public. Keep the SQL file in sync when adding tables or columns.

### localStorage keys

`nikadi_layout_<templateFingerprint>` (auto-saved element layout per template), `nikadi_last_event` (last opened event id) and `nikadi_theme` (`light`/`dark`; absent = follow the browser).

## Conventions

- Match the surrounding code: 2-space indent, terse arrow functions, `async` handlers defined inside `<App>`, and a short `//` comment above each non-trivial function explaining what it does and any provider quirks. `App.jsx` uses CRLF line endings.
- Styling is inline `style={{...}}` plus the `CSS` template string (`nk-*` class names). Use the `N` colour tokens (e.g. `N.sky`, `N.green`) — don't introduce hard-coded colours (the iPhone mockup and the canvas card artwork are the deliberate exceptions).
- **Light / dark theme.** `N` (from [src/lib/theme.js](src/lib/theme.js)) holds `var(--nk-*)` references; the actual dark and light values live in [src/index.css](src/index.css). The theme follows the browser's `prefers-color-scheme` unless the user picks Light/Dark with the header toggle (`<html data-theme>`, saved as `nikadi_theme`). Because tokens are `var(...)`, never append a hex alpha (`${N.sky}44`) — use `alpha(N.sky, "44")`. A new token must be added to `TOKENS` in theme.js and to all three blocks in index.css.
- Table-row action buttons use the `<Sb>` component; badges use `nk-badge badge-*` classes.
- User feedback goes through `showToast(msg, type)` with `type` one of `"success" | "warn" | "info"`. Toasts stay `NOTICE_VISIBLE_MS` (5 s); `showToast` cancels the previous toast's timer so a newer toast always gets its full 5 s (don't add a bare `setTimeout(() => setToast(null))` anywhere).
- **Activity logs (`uploadLog`, `bulkLog`, `smsLog`) are shown only in the floating `position: fixed` panel (`.nk-activity`, rendered once in `<App>` via `<LogSection>`)** — never inline in a tab, so they can't shift the page layout. Each log clears itself `NOTICE_VISIBLE_MS` after its last change, but only once no entry is still `"uploading"`/`"sending"` (`useAutoClearLog`); a ✕ dismisses it sooner. Because logs vanish, never derive UI from `log.length` — e.g. the "Download WA Report" button reads `waReportReady` from `records`.
- Phone numbers go through `normalisePhone()` (E.164 without `+`, e.g. `255712345678`) before any API call, and bulk sends use `selectRecipients()` so already-sent, invalid and duplicate numbers are skipped.
- Any send that costs money or reaches a guest must: guard against double-fire, confirm before bulk, and never re-send to an already-sent contact without asking.
- **Confirmations use the in-app modal, never `window.confirm`/`alert`.** `askDialog({ title, body, actions })` resolves with the chosen action's `value` (or `null` on Cancel/Esc/click-outside); `confirmResend(name, what)` wraps it for "already sent, send again?"; `pickBulkRecipients({ title, emptyMsg, options })` is the one place bulk sends choose recipients — it shows who will be messaged and, when contacts share a number, offers **Send without duplicates** or **Send duplicates too**. Cancel is focused by default so a stray Enter can't send.
- **An event has several SMS messages.** The *main* message (`MAIN_MSG`) is `smsMessage` — `events.sms_message`/`sms_draft`, statuses in `records[].smsStatus` / `event_cards.sms_status`, which is what the Batch & Send and Reports tabs show. Extra messages are `extraMessages` (`events.sms_messages` JSONB, debounced autosave via `persistExtraMessages`; shape and pure helpers in [src/lib/messages.js](src/lib/messages.js)). Each extra message has `source: "contacts"` (the event contacts, per-message statuses in `statuses` keyed by `recipientKey` = phone + name) or `"upload"` (its own `recipients` list from an Excel/CSV or the VCard tab, each row carrying `smsStatus`; its `columns` become the placeholder chips). The SMS tab works on `activeMsgId` via `activeExtra` / `activeRecipients` / `activeBody`; `sendSmsToOne(idx, msgId)` and `sendAllSms(msgId)` default to the main message, and `setMessageStatuses` records results for any message. Like `sms_draft`, `persistEvent` never sends `sms_messages`.
- SMS/WA bodies are built from `{name}` / `{cardType}` / `{phone}` and any extra spreadsheet column as `{ColumnName}` (`buildSmsMsg`; `csvColumns` drives the clickable variable chips in the SMS tab).
- **SMS text has two persistence paths:** the manual **Save Template** button writes `events.sms_message`; the editor also **autosaves a draft** (debounced 1.5 s) to `events.sms_draft` (`smsDraftBase` tracks what was last loaded/saved). On load an autosaved draft wins over the template. `persistEvent` deliberately does NOT send `sms_draft`, so saving an event can't fail on a database that hasn't had the column added yet.
- Text elements carry a `fontFamily` (`FONT_OPTIONS`); `exportCard` waits for each font with `document.fonts.load` before drawing, because canvas drawing doesn't trigger web-font loading.
- Don't `console.log` request/response bodies from the messaging APIs — they contain guests' phone numbers.

## Gotchas

- **Stale closures in bulk flows.** `async` handlers see `records` as it was when they started. `saveCards(eventId, recs)` therefore takes the list to save; bulk-send flows pass `recordsRef.current` (kept current by an effect) or a locally computed next list. Don't call `saveCards(id)` after a long async loop and expect fresh statuses.
- **Upload state is in-memory only.** `saveCards()` writes `name/card_type/phone/wa_status/sms_status` and nothing else; `cardUrl` and `uploadStatus` are lost on reload or when reopening an event. A card must be uploaded again before it can be sent on WhatsApp (`sendWaSingle` bails with "Upload card first").
- `saveCards()` inserts the new rows first and only then deletes the pre-existing ones, so a failed insert can't wipe an event's contacts. It skips `sample` rows.
- `selectEvent()` is guarded by `selectSeq` — a slower, superseded load bails out instead of overwriting the newer event. It resets `records` to `sampleRecords()` when the event has no saved cards (never carry another event's contacts over).
- Startup data effects depend on `userId` (not the `user` object, which changes identity on every token refresh and would reload the open event over unsaved edits).
- The `whatsapp` tab body sits under a stray `{/* ─── BATCH & SEND ─── */}` comment above it — the real Batch & Send UI is the `tab === "batch"` block further down.
- The `wa-cards` bucket only works if `supabase-schema.sql` has been run (it creates the bucket with a 5 MB / `image/jpeg` limit and sign-in-only uploads).

## Secrets and environment

- Public config lives in `.env.local` (git-ignored via `*.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SMS_SENDER_ID`. See [.env.example](.env.example).
- Provider tokens (`VITE_SMS_BEARER_TOKEN`, `VITE_WA_BEARER_TOKEN`) go **only** in `.env.development.local`, which Vite loads for `npm run dev` and never for `npm run build`. Anything prefixed `VITE_` that is present at build time is baked into the public bundle — never put a secret in `.env.local`/`.env.production`. After a build, `grep` `dist/` for the token prefix to be sure.
- In production the provider tokens are Supabase secrets (`SMS_BEARER_TOKEN`, optional `WA_BEARER_TOKEN`, optional `ALLOWED_ORIGINS`) read by the Edge Functions.
- Never commit real tokens or paste them into `.claude/settings.local.json` allow-rules (that file is now git-ignored, but history still contains an old token that must be treated as compromised and rotated).

## Git

- Commit only when asked. Recent history uses short imperative subjects ("Add manual SMS template save, move access tokens to env vars, document App.jsx").
- Default branch is `main`. `origin/scanner` is an unmerged branch that splits `App.jsx` into per-tab components and adds an invite-only allowlist; expect merge conflicts in `App.jsx` and `supabase-schema.sql` when combining.

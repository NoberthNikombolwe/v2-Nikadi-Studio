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
npm run test:functions  # Edge Function tests: proxy + run-schedules (needs Node ≥ 22.18; mocks Deno + fetch)
npm run preview         # serve the production build
```

**Hosting (Heroku):** the repo root has `package.json` (`heroku-postbuild` builds `studio/`), `Procfile`, `server.js` (dependency-free static server for `studio/dist`: gzip, cache headers, HTTPS redirect, SPA fallback, `/healthz`) and `app.json`. `VITE_*` config vars are read at build time. Steps: README → "Deploy to Heroku".

**CI:** [.github/workflows/ci.yml](../.github/workflows/ci.yml) (git root) lints, tests (unit + Edge Functions), builds and smoke-tests `server.js` on every push/PR; Heroku deploys `main` after CI passes. GitHub Pages is no longer used. `vite.config.js` still takes `base` from `VITE_BASE_PATH` ("/" on Heroku); never hard-code root-absolute URLs (`"/foo"`) in app code — use `import.meta.env.BASE_URL`. Link-preview meta tags live in `index.html` and use `%SITE_URL%` (filled by the `nikadi-site-url` plugin in `vite.config.js` from `VITE_SITE_URL`); keep `public/og-image.jpg` 1200×630 and well under 300 KB or WhatsApp drops the preview.

Before finishing a change run `npm run lint`, `npm test`, `npm run test:functions` (if you touched `supabase/functions`) and `npm run build`, then exercise the UI in `npm run dev`. There are no component/UI tests — `App.jsx` is verified by hand.

## Architecture

- **Single-file UI.** The UI and state are in [src/App.jsx](src/App.jsx) (~2.8k lines): CSS-in-JS string, `<CardCanvas>`, `exportCard()`, `<EventModal>`, row components, and the default-exported `<App>` which owns all state and renders every tab. The header comment lists the file's sections top to bottom. Don't split it up unless asked.
- **Pure logic lives in `src/lib/` and is unit-tested:** [phone.js](src/lib/phone.js) (`normalisePhone`, `isValidPhone`), [recipients.js](src/lib/recipients.js) (`selectRecipients`, `describeSkipped` — who a bulk send goes to), [messages.js](src/lib/messages.js) (`fillTemplate`, `normaliseSheetRows`, per-message SMS status helpers), [supabase.js](src/lib/supabase.js) (client; exports `null` when env vars are missing, so guard with `if (!supabase)`). New non-UI logic belongs here with a test in `lib.test.js`. **Code shared with the Edge Functions** lives in [supabase/functions/_shared/messaging.js](supabase/functions/_shared/messaging.js) (plain JS, no browser/Deno APIs): `normalisePhone` / `isValidPhone` / `fillTemplate`, the provider-result readers (`smsStatusFromGroup`, `matchSmsResults`, `classifyWaSend`) and `scheduleTargets`; `phone.js`, `messages.js` and `schedule.js` re-export it — change it there, never copy it.
- Other files: [src/LoginPage.jsx](src/LoginPage.jsx) (Google sign-in gate shown until a session resolves), [src/main.jsx](src/main.jsx).
- **Tabs** (`tab` state, rendered in `<nav className="nk-tabs">`): `events`, `leads`, `customers`, `design`, `vcard`, `sms`, `whatsapp`, `batch` ("Batch & Send"), `reports`, `history`, `finance`, `calls`, `scanner`, `schedules` (all events' schedules), `settings`, `feedback`, `guide`. Nav order/groups come from `NAV_GROUPS`. The Guide (`<GuideTab>`, `<WelcomeModal>` on first sign-in, `nikadi_guide_seen` in localStorage) renders steps and progress from [src/lib/guide.js](src/lib/guide.js) — update its `GUIDE_STEPS` when a workflow changes. Each tab body is a `{tab === "..." && (...)}` block in `<App>`'s JSX. `selectEvent(ev, targetTab = "design")` loads an event and then switches to `targetTab` (pass `"reports"` for the Report shortcut, `null` to stay put); clicking an Events-table row opens it in Design.
- **Records** — the contact list is the `records` array in `<App>` state: `{ dbId?, name, cardType, phone, waStatus, smsStatus, cardUrl, uploadStatus, sample?, ...extra spreadsheet columns }`. `dbId` is the row's `event_cards.id` (set by `saveCards`/`selectEvent`). Sends save statuses through `recordSends` (see **Delivery reports**); `autoSaveCard(dbId, wa, sms)` is only its fallback before the delivery SQL exists. Status values come from the `WA` / `SMS` constants near the top of the file: WA `idle | sending | sent | delivered | read | notSent | invalid` (`waDone()` = sent, delivered or read), SMS `pending | sent | delivered | failed`. "sent" means accepted and waiting for the delivery report. `uploadStatus` is `"idle" | "uploading" | "uploaded" | "failed"`. `sample: true` marks placeholder rows from `sampleRecords()` (no phone; never saved).
- **Card rendering** — `designElements` (the layout) + a record are rasterised by `exportCard()` for download/zip/upload. It is async and **rejects** if the template or a QR image fails to load (never produces a card with a missing QR). Michango events hide the `qr` and `cardtype` elements (`isMichango`).
- **Messaging proxies** — `SMS_BASE` / `WA_BASE` point at the Vite proxy in dev (`import.meta.env.DEV`) and at the Supabase Edge Functions [send-sms](supabase/functions/send-sms/index.ts) / [send-wa](supabase/functions/send-wa/index.ts) in production. Both are thin wrappers over [_shared/proxy.ts](supabase/functions/_shared/proxy.ts), which requires a signed-in Supabase user, allowlists specific provider endpoints, and injects the provider token from a server-side secret. Client code gets its bearer token from `getApiToken("sms" | "wa")`: the provider token in dev, the user's session access token in production.
- **Heavy libs are lazy** — `xlsx` and `jszip` are npm packages loaded on demand via `loadXlsx()` / `loadJsZip()` (keeps them out of the initial bundle; nothing is fetched from a CDN at runtime). `xlsx` is pinned to SheetJS's own patched tarball (0.20.3) because the npm registry copy (0.18.5) has known vulnerabilities.

### Supabase

| Thing | Name | Used for |
|---|---|---|
| Table | `events` | event details, `elements_layout` JSON, `sms_message`/`sms_draft` (main SMS), `sms_messages` JSON (extra SMS messages) |
| Table | `event_cards` | one row per contact (`name, card_type, phone, wa_status, sms_status`, `card_url` = uploaded card image) |
| Table | `message_schedules` / `message_schedule_runs` / `message_run_targets` | scheduled SMS/WhatsApp sends: the schedule, one row per send time (status, counts), and the recipient list fixed when a send starts (server only) |
| Table | `saved_templates` | reusable background + layout |
| Table | `leads` | enquiries: name, phone, event type/date, `package_price` (TZS), region, venue, description, `status` (new → contacted → qualified / lost), `next_followup_date`, links to the `customer_id` / `event_id` it became |
| Table | `lead_followups` | contact notes per lead (method, note, next follow-up date, `created_by`) |
| Table | `customers` | qualified leads (or added directly); one customer → many `events` via `events.customer_id` (events also keep `lead_id`, `package_price`, `region`) |
| Table | `finance_accounts` | the business's money accounts (bank / mobile money / cash), `active` flag |
| Table | `event_transactions` | per-event `income` / `expense`: amount, `txn_date`, `account_id`, `party` (who paid / was paid), category, reference, note, `created_by` |
| Table | `app_roles` / `app_modules` / `role_permissions` | the 7 roles, the modules (≈ tabs), and each role's view/edit per module (Superuser is always everything) |
| Table | `app_users` | who may sign in (invite-only; trigger on `auth.users` rejects others) and their role, active flag, last seen |
| Table | `app_settings` / `wa_templates` / `sender_ids` / `card_type_rules` | Settings data: general values, WhatsApp templates, SMS sender IDs, card type → people |
| Table | `scan_logs` | every door check-in attempt (written only by `scan_card()`) |
| Table | `app_feedback` | users' feedback about the system (kind, rating, message, page, device) with the team's status + reply (SQL §10) |
| Table | `event_logs` | append-only event history: every card/SMS sent and its result, uploads, late WA reports, bulk summaries, event changes |
| Bucket | `templates` | template/background images |
| Bucket | `wa-cards` | per-contact rendered card JPEGs for WhatsApp (must stay public) |

Schema, RLS and bucket setup live in [supabase-schema.sql](supabase-schema.sql) (idempotent). Roles, settings, scanner and calls are in [supabase-roles-settings-scan.sql](supabase-roles-settings-scan.sql), which is **also appended to the end of supabase-schema.sql** (between the "BEGIN roles-settings-scan" marker and the end) — edit the standalone file, then re-copy it there; it must stay last because it replaces the open policies created earlier in the file. Policies call `has_perm(module, edit)` / `has_any_perm(...)` / `is_active_user()`; a new table needs policies of that form. The public scan page uses SECURITY DEFINER RPCs that check `events.scan_code` (`public_scan_event`, `public_find_cards`, `public_recent_scans`, `public_scan_stats`, `scan_card`) — still no anon table policies. RLS is **signed-in users only** — never add `anon` policies for these tables or buckets; the anon key is public. Keep the SQL file in sync when adding tables or columns.

### Roles, settings, scanner, calls

- **Super Admin** is the display name of role key `superuser` (never rename the key). **Only Super Admins can delete data**: RESTRICTIVE `FOR DELETE` policies (`p_<table>_delete_super_admin`) on events, customers, leads, follow-ups, finance, templates and settings tables; the UI hides delete buttons via `useCanDelete()` (`CanDeleteContext`, provided by `<App>`). Guest-list re-saves (`event_cards`) and team changes (`event_assignments`) are edits and stay allowed. A new delete button must be wrapped in `{canDelete && (...)}`.
- **Navigation**: `NAV_GROUPS` with `eventOnly: true` (Studio, Insight, Guests) only appear while an event is open (`savedEventId`); a tab that leaves the menu sends the user to the first visible tab. On wide screens the group holding the current tab shows all its tabs; other groups (with more than one tab) collapse to one button whose sub-menu (`.nk-navdrop`) opens on hover, keyboard focus or tap (`navOpen`). The menu drawer (`menuOpen`) always lists everything.
  - **Tablets (761–900px):** the header's menu button opens the drawer from the side.
  - **Phones (≤760px):** bottom navigation instead (`.nk-bottomnav`). It holds up to four sections from `phoneNavGroups` ([src/lib/permissions.js](src/lib/permissions.js): Sales, Studio, Guests, Insight first) plus **More**, which opens the same drawer as a sheet from the bottom with each section's pages as tiles.
    - A tap on a section opens the page used last there (`sectionTab`, `lastTabRef`). A tap on the current section scrolls to the top.
    - A section with several pages shows them in a sticky row under the header (`.nk-subnav`).
    - On the Scanner tab the scanner's own bar (with a Menu button, `onMenu`) replaces this bar: `body:has(.sp-tabbar)` hides it.
    - Fixed things near the bottom (toast, activity panel) are lifted above the bar. A new fixed-bottom element must be too.
- **`useAccess()`** (App.jsx) loads my `app_users` row, `role_permissions` (→ `matrixFromRows`) and every Settings list. `access.can(module, "view"|"edit")` gates UI; `navGroups` = `visibleNav(NAV_GROUPS, …)`; a tab without edit shows a "View only" banner. Not invited / deactivated → `<NoAccess>`. If the roles tables don't exist yet (`access.setupMissing`) everyone keeps full access. Keep `DEFAULT_MATRIX` in [src/lib/permissions.js](src/lib/permissions.js) identical to the SQL seed — a test compares them. New tab → add it to `TAB_MODULE` and (if new) to `MODULES` + `app_modules`.
- **Edge Functions** pass `module` to `createProxy` (`sms` / `whatsapp`); the proxy calls `has_perm` with the user's JWT (edit for POST) and returns 403 otherwise.
- **WhatsApp template / SMS sender** come from Settings: `resolveChoice(list, event's choice, key)` → event's own (`events.wa_template` / `events.sms_sender_id`, saved by `rememberForEvent`) else the default. The WA request's `account` is the template's or `app_settings.wa_account`.
- **Card types → people**: `peopleForCardType` ([src/lib/cardRules.js](src/lib/cardRules.js)) mirrors SQL `people_for_card_type()`; a trigger keeps `event_cards.max_scans` in sync and re-syncs all cards when rules/settings change.
- **QR codes** carry `ID=<event_cards.id>;Name=…;TypeCard=…` (`buildQrPayload`); `parseQrPayload` + `matchByName` handle older ID-less cards. **`saveCards` updates existing rows in place** (keeps ids, scan and call progress), inserts new ones, deletes removed ones last — never go back to delete-and-reinsert. Calls and check-ins are a ledger: `planCardSave` ([src/lib/guestMerge.js](src/lib/guestMerge.js)) matches re-uploaded rows to existing cards (dbId → phone+name → phone → name) so they keep id, call and scan data, and never deletes a card with call/scan history (`hasLedger`) — those are kept and re-added to the list. saveCards never writes call_* / scan columns.
- **Scanner**: `<ScanPanel>` ([src/ScanPanel.jsx](src/ScanPanel.jsx)) is shared by `<ScannerTab>` and `<PublicScanPage>` (`#/scan/<eventId>`, routed in main.jsx, no login). Check-ins only via `scan_card()` (atomic; multi-person cards prompt for a count). `html5-qrcode` is lazy-imported from npm. `useEventCards` keeps the list live via realtime.
  - **Camera:** the camera is driven only through `createCamera` ([src/lib/camera.js](src/lib/camera.js), unit-tested with a fake phone camera). It counts only the first code of a scan and never stops the library from inside its own callback. Stopping waits for a start still in progress, then stops the library, then `releaseCameraBox` stops any leftover track. A new start waits for the old camera to be released, and leaving or locking the page stops it.
  - **Why:** the old code stopped inside the callback, so a card read before the camera finished starting left it running hidden, and "Scan next card" failed until the screen was locked. Don't bypass the controller.
  - **Phones** (`SCANNER_PHONE` = ≤760px, `useMediaQuery` in [src/useMediaQuery.js](src/useMediaQuery.js)): one view at a time with `<ScanTabBar>`.
    - **Scanner tab bar:** it also has **Menu** (the app's full menu), because it replaces the app's bottom navigation on this tab.
    - **Scanner tab views:** Statistics (`<ScanStats>` from `scanBreakdown`: cards by size single / double / group, scanned / not scanned, the Excel check-in report `scanReportRows`, recent scans, Refresh / Import / Share), Scan, and Guests (`<GuestList compact>`: one row per card with one button — Check in / Check in more / Fully in; tapping the name edits the comment).
    - **Public scan page views:** Statistics (`public_scan_stats` RPC; it falls back to the `public_scan_event` totals on an older database), Scan, and Recent. There is no full guest list there on purpose.
    - **How the panel follows the view:** `ScanPanel` stays mounted and gets `section` (`all` | `scan` | `list` | `none`), so the count prompt works from the guest list. Leaving the Scan view stops the camera. Tapping the Scan tab bumps `startSignal`, which opens the camera.
- **Event teams**: `event_assignments` (event, email, task). Non-"sees all events" roles (flag `app_roles.sees_all_events`, toggled in Settings → Roles & permissions; default Superuser, Admin, Finance Officer) only see events they are assigned to or created (`events.created_by`) — enforced by `can_see_event()` in every event-scoped policy and in `scan_card()`. The creator is auto-assigned as Owner (trigger). `<TeamPanel>` in `<EventOverview>` adds/removes people (picker uses the `assignable_users()` RPC); `<TeamAvatars>` shows the team in the Events table.
- **View-only share link**: `#/view/<eventId>` → `<PublicViewPage>` ([src/PublicViewPage.jsx](src/PublicViewPage.jsx), routed in main.jsx, no login). Code in `events.view_code`, set via the `set_view_code()` RPC (`<ShareViewModal>` on the Calls and History tabs). Data only through `public_view_event` / `public_view_guests` / `public_view_history` (phones masked by `mask_phone()`); read-only.
- **Guest comments** (`event_cards.call_comment`) can be added from the Calls tab and the Scanner guest list (`<GuestList onComment>`); both log to history (channel `calls`).
- **Scheduled sends** (SQL §9, [src/lib/schedule.js](src/lib/schedule.js), [_shared/scheduler.ts](supabase/functions/_shared/scheduler.ts)):
  - **In the app:** `<ScheduledSends channel>` sits in the left column of the SMS and WhatsApp tabs. It uses `useSchedules` (realtime) and opens `<ScheduleModal>` (new / edit) and `<ScheduleDetail>` (runs, pause / resume / cancel, Super Admin delete).
  - **Send times are fixed when saving:** the browser works out every time in local time (`buildRunTimes` / `validateSchedule`: no past times, at most 100) and saves the list with the `save_message_schedule()` RPC. That RPC re-checks role, event and that no time is in the past; editing replaces only the pending runs. Users never write these tables directly: pause, resume and cancel go through `set_message_schedule_status()`.
  - **Sending:** pg_cron job `nikadi-run-schedules` posts to the `run-schedules` Edge Function every minute while a run is due. The project URL and `x-cron-secret` come from Vault, and the function checks `CRON_SECRET`.
    - The function works with the service role (`claim_schedule_run` lease → `save_run_progress` → `finish_schedule_run`) in about 35 s slices: SMS go out 100 per `/text/multi`, WhatsApp one by one with a 1 s gap.
    - It writes `event_logs` itself, with `user_email` = the schedule's creator.
    - Only main-SMS (`message_key = 'main'`) and card-image (`wa_image`) schedules change guest statuses (`set_card_send_statuses`).
  - **Late or paused runs:** a run more than 2 h late is skipped, not sent, and so are runs that came due while the schedule was paused.
  - **Placeholders:** scheduled SMS can only use `{name}` / `{cardType}` / `{phone}`, because extra spreadsheet columns aren't stored.
- **Schedules page** (`tab === "schedules"`, `<SchedulesTab>`): every schedule across the events you can see, with filters, counts and create / view / edit / pause / resume / cancel / delete.
  - It reuses `<ScheduleModal>` / `<ScheduleDetail>` and `useScheduleActions` (shared with the SMS / WhatsApp panels).
  - **With an event open** (`current`, keyed by `savedEventId`): the page starts filtered to that event ("Show all events" to widen it), and **New schedule** is for that event.
    - The picker asks only SMS or WhatsApp; it goes straight to the form when the role has just one, and "Choose another event" still works.
    - The open event uses `scheduleInputs` from `<App>`: live SMS text / extra messages (unsaved edits included), sender and template. These are the same props the SMS / WhatsApp panels get.
  - **Other events:** they use `scheduleInputsFor(ev, access)`, which builds the messages, sender and templates from the saved event row.
  - The tab shows with SMS **or** WhatsApp view (`canSeeTab`), and each row checks its own channel's edit permission (no blanket View-only banner).
- **Feedback** (SQL §10, [src/lib/feedback.js](src/lib/feedback.js)):
  - **Sending:** every signed-in user sends feedback from the header **Feedback** button (`<FeedbackModal>`, also in the phone drawer) and sees their own under *My feedback* with the team's reply. They can edit it while it is still `new`.
  - **Answering:** the `feedback` module (Admin: edit by default) gets the Feedback tab (`<FeedbackTab>`, `<FeedbackDetail>`) to set the status (new → seen → planned → done / won't do), reply and export to Excel.
  - **Rules:** `guard_app_feedback()` fixes the sender, status and reply on insert and locks the sender's edits once seen. Delete is Super Admin only.
- **Delivery reports** (SQL §11, [src/lib/deliveries.js](src/lib/deliveries.js), shared status table `PROVIDER_STATUS` in [_shared/messaging.js](supabase/functions/_shared/messaging.js)):
  - **Recording sends:** every send is recorded with NextSMS's `messageId` in `message_deliveries` via `record_message_sends` (`recordSends` in the app; the scheduler too).
    - Parse provider answers with `parseProviderJson`: messageIds are ~19-digit numbers that `JSON.parse` would round.
    - For the main SMS (`message_key 'main'`) and the WhatsApp card (`'card'`), the RPC also sets the guest's `sms_status` / `wa_status`. **The database is the source of truth:** `saveCards` never writes statuses of saved guests.
  - **Applying results:** `apply_delivery_results` moves a message forwards only (sent → delivered / read / failed, delivered → read).
    - It updates the guest only for their latest send of it, and writes a History row (action `status`, user "delivery report").
    - Results come from three places:
      - the `delivery-webhook` function (NextSMS callback, Verify Token = `NEXTSMS_CALLBACK_TOKEN`, 5 s and no retries)
      - `run-schedules` `{task:"deliveries"}`: cron `nikadi-sync-deliveries` every 5 min, which claims due rows with `claim_pending_deliveries` for up to 3 days
      - `checkDeliveries` in the app: quick checks after a send, and "Check delivery now"
  - **Rules:**
    - Go by the status **id**, never the group: group 20 also holds UNDELIVERABLE.
    - **Always look reports up by messageId.** `GET /api/v2/reports` without `messageId` *consumes* the reports.
    - Keep SQL `delivery_state()` identical to `PROVIDER_STATUS`; a test compares them.
  - **In the app:** `useDeliveries` (realtime) patches `records` live (`applyDelivery`). `deliveryIndex` gives the latest delivery per guest (badge tooltips via `smsNote` / `waNote` / `extraNote`), and overlays extra-message results (`extraStatusOf`) without rewriting `events.sms_messages`.
  - **Reports tab:** `<ReportsTab>` shows guest counts, failure reasons, the delivery log (Excel), and the NextSMS account log (`/api/v2/logs` via the `send-sms` proxy, SMS view).
- **Calls**: `<CallsTab>` updates `event_cards.call_status` (`picked|busy|yes|no`, flow in [src/lib/calls.js](src/lib/calls.js)) and logs each change to history (channel `calls`).

### localStorage keys

`nikadi_layout_<templateFingerprint>` (auto-saved element layout per template), `nikadi_last_event` (last opened event id) , `nikadi_theme` (`light`/`dark`; absent = follow the browser) , `nikadi_guide_seen` (welcome pop-up already shown) and `nikadi_door_name` (public scan page). The public scan code is kept in sessionStorage (`nikadi_scan_code_<eventId>`).

## Conventions

- Match the surrounding code: 2-space indent, terse arrow functions, `async` handlers defined inside `<App>`, and a short `//` comment above each non-trivial function explaining what it does and any provider quirks. `App.jsx` uses CRLF line endings.
- Styling is inline `style={{...}}` plus the `CSS` template string (`nk-*` class names). Use the `N` colour tokens (e.g. `N.sky`, `N.green`) — don't introduce hard-coded colours (the iPhone mockup and the canvas card artwork are the deliberate exceptions).
- **Light / dark theme.** `N` (from [src/lib/theme.js](src/lib/theme.js)) holds `var(--nk-*)` references; the actual dark and light values live in [src/index.css](src/index.css). The theme follows the browser's `prefers-color-scheme` unless the user picks Light/Dark with the header toggle (`<html data-theme>`, saved as `nikadi_theme`). Because tokens are `var(...)`, never append a hex alpha (`${N.sky}44`) — use `alpha(N.sky, "44")`. A new token must be added to `TOKENS` in theme.js and to all three blocks in index.css.
- **No emoji in the UI.** Icons are inline SVGs from [src/Icon.jsx](src/Icon.jsx): `<Icon n="save" />` (inherits colour and font size; `n="loader"` spins). Add a new icon to its `P` map. `icon` fields in `src/lib` (history channels, follow-up methods, account types) hold icon *names*. `<option>` text can't hold SVG, so options are plain text.
- Viewing one record (lead, customer, finance event) opens `<DetailModal label onClose>` over the full-width list — not a side panel. It closes only via its ✕; confirmations use `nk-top` (z 700) and `<EventOverview>` `nk-raise` (z 550) so they sit above detail pop-ups (z 500).
- Empty, loading and error placeholders use `<EmptyState icon title text action loading compact tone>` so every tab looks and behaves the same; give each one a next step where there is one.
- Table cells are one line (`white-space: nowrap`, "…" past 280px; a document-level hover handler adds the full text as a tooltip). Inside `.nk-table`, `<Sb>` buttons with an icon show the icon only; always pass `label="Verb the thing"` (it becomes the tooltip + `aria-label`). Icon-only `<button>`s need `aria-label` + `title`.
- **Tables on phones (≤640px) keep only their important columns and actions.** Every `.nk-table` says which columns phones drop:
  - **Whole columns:** `className="nk-table m-hide-3 m-hide-4"` drops the 3rd and 4th (rules from `hideColumnRules` in [src/lib/mobileTable.js](src/lib/mobileTable.js); rows with a `colSpan` cell are untouched).
  - **One cell or button:** `m-hide` (`<Sb className="m-hide">`, a conditional `<th>`/`<td>`, or ListEditor's `opt: true`).
  - **Pinned actions:** `m-act` pins the last (actions) column to the right while the rest scrolls.
  - **New tables:** a new table or column must make this choice. Count positions with any conditional columns in mind, and use `m-hide` for those columns.
- Table-row action buttons use the `<Sb>` component; badges use `nk-badge badge-*` classes.
- User feedback goes through `showToast(msg, type)` with `type` one of `"success" | "warn" | "info"`. Toasts stay `NOTICE_VISIBLE_MS` (5 s); `showToast` cancels the previous toast's timer so a newer toast always gets its full 5 s (don't add a bare `setTimeout(() => setToast(null))` anywhere).
- **Activity logs (`uploadLog`, `bulkLog`, `smsLog`) are shown only in the floating `position: fixed` panel (`.nk-activity`, rendered once in `<App>` via `<LogSection>`)** — never inline in a tab, so they can't shift the page layout. Each log clears itself `NOTICE_VISIBLE_MS` after its last change, but only once no entry is still `"uploading"`/`"sending"` (`useAutoClearLog`); a ✕ dismisses it sooner. Because logs vanish, never derive UI from `log.length` — e.g. the "Download WA Report" button reads `waReportReady` from `records`.
- Phone numbers go through `normalisePhone()` (E.164 without `+`, e.g. `255712345678`) before any API call, and bulk sends use `selectRecipients()` so already-sent, invalid and duplicate numbers are skipped.
- Any send that costs money or reaches a guest must: guard against double-fire, confirm before bulk, and never re-send to an already-sent contact without asking.
- **Confirmations use the in-app modal, never `window.confirm`/`alert`.** `askDialog({ title, body, actions })` resolves with the chosen action's `value` (or `null` on Cancel). **Pop-ups never close on a backdrop click or Esc** — only through their own ✕ / Cancel / Close buttons; `confirmResend(name, what)` wraps it for "already sent, send again?"; `pickBulkRecipients({ title, emptyMsg, options })` is the one place bulk sends choose recipients — it shows who will be messaged and, when contacts share a number, offers **Send without duplicates** or **Send duplicates too**. Cancel is focused by default so a stray Enter can't send.
- **An event has several SMS messages.** The *main* message (`MAIN_MSG`) is `smsMessage` — `events.sms_message`/`sms_draft`, statuses in `records[].smsStatus` / `event_cards.sms_status`, which is what the Batch & Send and Reports tabs show. Extra messages are `extraMessages` (`events.sms_messages` JSONB, debounced autosave via `persistExtraMessages`; shape and pure helpers in [src/lib/messages.js](src/lib/messages.js)). Each extra message has `source: "contacts"` (the event contacts, per-message statuses in `statuses` keyed by `recipientKey` = phone + name) or `"upload"` (its own `recipients` list from an Excel/CSV or the VCard tab, each row carrying `smsStatus`; its `columns` become the placeholder chips). The SMS tab works on `activeMsgId` via `activeExtra` / `activeRecipients` / `activeBody`; `sendSmsToOne(idx, msgId)` and `sendAllSms(msgId)` default to the main message, and `setMessageStatuses` records results for any message. Like `sms_draft`, `persistEvent` never sends `sms_messages`.
- SMS/WA bodies are built from `{name}` / `{cardType}` / `{phone}` and any extra spreadsheet column as `{ColumnName}` (`buildSmsMsg`; `csvColumns` drives the clickable variable chips in the SMS tab).
- **SMS text has two persistence paths:** the manual **Save Template** button writes `events.sms_message`; the editor also **autosaves a draft** (debounced 1.5 s) to `events.sms_draft` (`smsDraftBase` tracks what was last loaded/saved). On load an autosaved draft wins over the template. `persistEvent` deliberately does NOT send `sms_draft`, so saving an event can't fail on a database that hasn't had the column added yet.
- Text elements carry a `fontFamily` (`FONT_OPTIONS`); `exportCard` waits for each font with `document.fonts.load` before drawing, because canvas drawing doesn't trigger web-font loading.
- **CRM (Leads / Customers tabs).** `useCrm()` in App.jsx owns the lead/customer data and every write (it's the one exception to "`<App>` owns all state"); `<LeadsTab>`, `<CustomersTab>`, `<LeadModal>`, `<CustomerModal>` and `<EventOverview>` render it, and pure logic (price parsing `1.2k` → 1200, validation, sorting by follow-up urgency, `eventFromLead`) is in [src/lib/crm.js](src/lib/crm.js). Qualifying a lead reuses a customer with the same normalised phone (`matchCustomer`) or creates one, optionally creates the event, then marks the lead `qualified`. `<EventOverview>` (Events table → 🔎 Overview, or any event in the CRM tabs) loads everything related to one event itself; it's keyed by event id. Without the CRM tables the tabs show `<CrmUnavailable>` instead of failing.
- **`persistEvent` writes only `EVENT_FORM_FIELDS`** (the Edit button passes the whole DB row), and stamps the designer's cover/layout/SMS text only onto the event open in the designer (or a new one). Add a new editable event column to `EVENT_FORM_FIELDS`.
- **Event history.** Anything that sends to a guest or changes an event must call `logHistory({ channel, action, status, name, phone, title, detail }, eventId?)` (fields validated by `buildLogRow` in [src/lib/history.js](src/lib/history.js); unknown channel/action/status values are rejected). It batches rows into `event_logs` (~1 s / 50 rows), never throws, and is a no-op without a saved event. `event_logs` is append-only (RLS: SELECT + INSERT only; `user_email` is set by the DB from the JWT) — don't add update/delete paths. The History tab (`loadHistory`, `HISTORY_PAGE` rows per page) filters with `filterHistory` and summarises with `summariseHistory`.
- **Finance tab.** `useFinance()` (like `useCrm`) owns accounts + transactions and their writes; `<FinanceTab>`, `<TxnModal>`, `<AccountsModal>` render it. Pure logic (validation, profit, margin % = profit / income, per-account / per-category totals, filters, Excel rows) is in [src/lib/finance.js](src/lib/finance.js). Adding, editing (`updateTxn`, logs what changed) or removing a transaction logs to the event history (`channel:"finance"`, actions `income` / `expense` / `txn_edit` / `remove`). `<TxnModal initial={txn}>` edits an existing one.
- **Bulk sends never skip already-sent contacts silently.** `pickBulkRecipients` lists them and offers **Send again to all** next to the normal "new only" choice; when everyone was already sent, the dialog offers only the resend.
- Don't `console.log` request/response bodies from the messaging APIs — they contain guests' phone numbers.

## Gotchas

- **Stale closures in bulk flows.** `async` handlers see `records` as it was when they started. `saveCards(eventId, recs)` therefore takes the list to save; bulk-send flows pass `recordsRef.current` (kept current by an effect) or a locally computed next list. Don't call `saveCards(id)` after a long async loop and expect fresh statuses.
- **Uploaded cards are saved as `event_cards.card_url`.**
  - **Saving:** `uploadCardSingle` saves it via `saveCardUrl` once the row has a `dbId`, and `saveCards` stores it too.
    - `saveCards` writes the column only when the saved rows have it, so it can't fail on a database without the schedules SQL.
    - A row matched from a new sheet keeps the old image only if its name and card type are unchanged (`sameCardFace`).
  - **Loading:** `selectEvent` and the merge on spreadsheet upload restore `cardUrl` / `uploadStatus` with `cardFromRow`.
  - **Clearing:** `changeTemplate` and Settings → Storage → Clear set it back to null in the database too.
  - **No URL:** without one, a card must be uploaded again before it can be sent on WhatsApp (`sendWaSingle` bails with "Upload card first").
- `saveCards()` inserts the new rows first and only then deletes the pre-existing ones, so a failed insert can't wipe an event's contacts. It skips `sample` rows.
- `selectEvent()` is guarded by `selectSeq` — a slower, superseded load bails out instead of overwriting the newer event. It resets `records` to `sampleRecords()` when the event has no saved cards (never carry another event's contacts over).
- Startup data effects depend on `userId` (not the `user` object, which changes identity on every token refresh and would reload the open event over unsaved edits).
- The `whatsapp` tab body sits under a stray `{/* ─── BATCH & SEND ─── */}` comment above it — the real Batch & Send UI is the `tab === "batch"` block further down.
- The `wa-cards` bucket only works if `supabase-schema.sql` has been run (it creates the bucket with a 5 MB / `image/jpeg` limit and sign-in-only uploads).

## Secrets and environment

- Public config lives in `.env.local` (git-ignored via `*.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SMS_SENDER_ID`. See [.env.example](.env.example).
- Provider tokens (`VITE_SMS_BEARER_TOKEN`, `VITE_WA_BEARER_TOKEN`) go **only** in `.env.development.local`, which Vite loads for `npm run dev` and never for `npm run build`. Anything prefixed `VITE_` that is present at build time is baked into the public bundle — never put a secret in `.env.local`/`.env.production`. After a build, `grep` `dist/` for the token prefix to be sure.
- In production the provider tokens are Supabase secrets (`SMS_BEARER_TOKEN`, optional `WA_BEARER_TOKEN`, optional `ALLOWED_ORIGINS`) read by the Edge Functions. `run-schedules` also needs `CRON_SECRET`, equal to the Vault secret `nikadi_cron_secret` (README Step 9). `delivery-webhook` needs `NEXTSMS_CALLBACK_TOKEN`, equal to the Verify Token in the NextSMS dashboard (README Step 10). Never put any of these values in a committed file.
- Never commit real tokens or paste them into `.claude/settings.local.json` allow-rules (that file is now git-ignored, but history still contains an old token that must be treated as compromised and rotated).

## Git

- Commit only when asked. Recent history uses short imperative subjects ("Add manual SMS template save, move access tokens to env vars, document App.jsx").
- Default branch is `main`. `origin/scanner` is an unmerged branch that splits `App.jsx` into per-tab components and adds an invite-only allowlist; expect merge conflicts in `App.jsx` and `supabase-schema.sql` when combining.

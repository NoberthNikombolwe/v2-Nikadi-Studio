# Nikadi Studio — Architecture

**Last updated:** 2026-11-16

---

## 1. High-Level Overview

```
Browser (React SPA)
  │
  ├── Supabase (Postgres + Auth + Storage + Realtime)
  │     ├── Tables: events, event_cards, leads, customers, finance…
  │     ├── SECURITY DEFINER RPCs: public scan/view/guest pages
  │     ├── Storage buckets: templates, wa-cards, fonts, event-pages
  │     └── Edge Functions: send-sms, send-wa, run-schedules, ai-clean
  │
  └── messaging-service.co.tz (SMS + WhatsApp provider)
        ├── Dev: proxied by Vite (/sms-proxy, /wa-proxy)
        └── Prod: via Supabase Edge Functions (token injected server-side)
```

---

## 2. Frontend

### 2.1 Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Build | Vite 8 |
| Language | JavaScript (JSX) |
| Styling | CSS-in-JS string injected via `<style>` + CSS variables |
| Hosting | Heroku (Node.js static server in `server.js`) |

### 2.2 Single-File UI

The entire application UI lives in `studio/src/App.jsx` (~3 000 lines). Do not split it. The file is organised top-to-bottom:

```
BRAND            → CSS string, theme tokens
Helpers          → pure functions (phone, QR URL, VCF, etc.)
CARD CANVAS      → <CardCanvas>, exportCard()
EVENT MODAL      → <EventModal> create/edit form
CRM              → useCrm(), <LeadsTab>, <CustomersTab>, <EventOverview>
SCANNER & CALLS  → <ScannerTab>, <CallsTab>, CARD_COLS constant
GUEST LINKS      → <GuestLinksModal>, <EventPageModal>
FINANCE          → <FinanceTab>
HISTORY          → <HistoryTab>
REPORTS          → <ReportsTab>
SMS              → <SmsTab>, buildSmsMsg()
WHATSAPP         → <WhatsAppTab>
SCHEDULES        → <SchedulesTab>
SETTINGS         → <SettingsTab>
FEEDBACK         → <FeedbackTab>
GUIDE            → <GuideTab>
MAIN APP         → <App> (default export, all state, tab routing)
```

### 2.3 Routing

Hash-based routing (no React Router):

```
#/scan/<eventId>                     → <PublicScanPage>   (door check-in)
#/view/<eventId>                     → <PublicViewPage>   (view-only report)
#/g/<eventPublicId>/<guestPublicId>  → <PublicGuestPage>  (personalised invitation)
(none)                               → <App>              (admin panel)
```

Routing is in `src/main.jsx` via `window.location.hash` regex matches.

### 2.4 State Model

All app state lives in `<App>` and is passed down as props. There is one `CanDeleteContext` for delete-button visibility.

**Key state:**
- `savedEvents` — array of all events from Supabase
- `records` — current event's guest list (contact + send status per guest)
- `designElements` — current event's card layout (draggable elements)
- `tab` — which tab is active
- `savedEventId` / `openEventRow` — the currently loaded event
- `user` / `role` — Supabase auth session

### 2.5 Lib Modules

Pure logic (no React, no Supabase) lives in `src/lib/`:

| File | Contents |
|------|----------|
| `phone.js` | `normalisePhone`, `isValidPhone` |
| `messages.js` | `fillTemplate`, `normaliseSheetRows`, SMS/WA status helpers |
| `recipients.js` | `selectRecipients`, `describeSkipped` |
| `permissions.js` | Roles, modules, permission matrix, `can()` |
| `crm.js` | Lead/customer helpers, TZS formatting, regions |
| `finance.js` | Transaction helpers, P&L summaries |
| `cardRules.js` | Card type → people, scan state helpers |
| `cardFooter.js` | Footer pill drawing helpers |
| `scan.js` | QR payload building, scan matching |
| `schedule.js` | Schedule helpers, cron-pattern generation |
| `deliveries.js` | Delivery report parsing and indexing |
| `guestMerge.js` | Import merge: keep/update/add logic |
| `history.js` | Audit log row builders |
| `assignments.js` | Team assignment helpers |
| `guide.js` | Onboarding guide steps |
| `feedback.js` | Feedback form helpers |
| `theme.js` | `N` tokens, `alpha()`, `applyTheme()` |
| `fonts.js` | Card font list, upload helpers |
| `settings.js` | Settings defaults and validators |

### 2.6 Shared with Edge Functions

`supabase/functions/_shared/messaging.js` contains logic used by both the browser and Edge Functions:
- `normalisePhone`, `isValidPhone`, `fillTemplate`
- Provider result readers (`smsStatusFromGroup`, `matchSmsResults`, `classifyWaSend`)
- `scheduleTargets`

**Never copy this — always import from the same file.**

---

## 3. Backend (Supabase)

### 3.1 Database

Supabase-managed Postgres. Schema is in `studio/supabase-schema.sql` (idempotent — safe to re-run).

**Key tables:**

```
events               ─── top-level event records
event_cards          ─── one row per guest
event_logs           ─── append-only audit log
leads / lead_followups ─── CRM pipeline
customers            ─── qualified customers
finance_accounts     ─── bank/mobile/cash accounts
event_transactions   ─── per-event income and expenses
saved_templates      ─── reusable card designs
message_schedules    ─── scheduled SMS/WA sends
message_deliveries   ─── delivery report per send
app_users / app_roles / app_modules / role_permissions ─── RBAC
app_settings / wa_templates / sender_ids / card_type_rules ─── config
scan_logs            ─── door check-in attempts
app_feedback         ─── user feedback
event_pages          ─── public microsite settings per event
event_rsvps          ─── RSVP submissions from public page
```

### 3.2 Row Level Security

All tables use RLS. The anon role has zero direct table access. Signed-in users access data via `authenticated` policies.

Policy pattern:
```sql
-- Full CRUD for all authenticated users (no per-user row ownership)
CREATE POLICY "authenticated_all_<table>" ON <table>
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Delete is locked to superuser via RESTRICTIVE policy
CREATE POLICY "p_<table>_delete_super_admin" ON <table>
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (has_perm('some_module', FALSE) AND is_active_user());
```

Public pages use `SECURITY DEFINER` RPCs that expose only minimum fields:
- `public_guest_card()` — guest name, card, card_url (legacy)
- `public_event_page_data()` — full microsite data bundle
- `submit_rsvp()` — RSVP write path for anon
- `scan_card()`, `public_scan_event()` etc. — scanner RPCs

### 3.3 Real-time

Supabase Realtime is enabled on:
- `event_cards` — scanner live updates across devices
- `scan_logs` — live scan feed
- `message_deliveries` — delivery report streaming

### 3.4 Storage Buckets

| Bucket | Access | Contents |
|--------|--------|----------|
| `templates` | Authenticated | Card background images |
| `wa-cards` | Public | Per-guest rendered card JPEGs (WhatsApp links must be public URLs) |
| `fonts` | Authenticated | Uploaded custom card fonts |
| `event-pages` | Public | Microsite images (hero, gallery, dress code) |

### 3.5 Edge Functions

Located in `supabase/functions/`:

| Function | Purpose |
|----------|---------|
| `send-sms` | SMS proxy — validates session, injects provider token, forwards to messaging-service.co.tz |
| `send-wa` | WhatsApp proxy — same pattern |
| `run-schedules` | Called by `pg_cron` every minute; processes due scheduled sends |
| `ai-clean` | Gemini API proxy for the "Clean data" chat feature |
| `_shared/proxy.ts` | Shared proxy logic (token injection, endpoint allowlist) |
| `_shared/messaging.js` | Shared messaging helpers (also used by browser) |
| `_shared/dataClean.js` | AI clean chat logic (also used by Vite dev plugin) |

---

## 4. Messaging Provider

Provider: **messaging-service.co.tz**

- SMS: `POST /api/sms/v2/...`
- WhatsApp: `POST /api/wa/v2/...`
- Bearer token is a provider-issued API key
- In dev: Vite proxy forwards the token from `.env.development.local`
- In prod: Edge Functions inject it from Supabase Vault secrets

---

## 5. CI/CD

```
GitHub push/PR → GitHub Actions (.github/workflows/ci.yml)
  ├── npm run lint
  ├── npm test          (src/lib unit tests)
  ├── npm run test:functions (Edge Function tests)
  ├── npm run build
  └── smoke-test server.js

main branch → Heroku auto-deploy (after CI passes)
```

**Heroku setup:**
- `heroku-postbuild` script builds `studio/`
- `Procfile` runs `node server.js`
- `server.js`: dependency-free static file server with gzip, cache headers, HTTPS redirect, SPA fallback, `/healthz` endpoint

---

## 6. Environment Variables

| Variable | Where | Used for |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | Build | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Build | Supabase anon/publishable key |
| `VITE_BASE_PATH` | Build | URL path prefix (Heroku: `/`) |
| `VITE_SITE_URL` | Build | Full URL for OG image meta tags |
| `VITE_SMS_BEARER_TOKEN` | Dev only | SMS provider token (dev proxy) |
| `VITE_WA_BEARER_TOKEN` | Dev only | WhatsApp provider token (dev proxy) |
| `GEMINI_API_KEY` | Dev only | Gemini API key for AI clean chat (not `VITE_` — never reaches browser) |

Production secrets (Supabase Vault):
- `nikadi_sms_token` — SMS provider API key
- `nikadi_wa_token` — WhatsApp provider API key
- `nikadi_project_url` — Supabase project URL (used by pg_cron jobs)
- `nikadi_cron_secret` — HMAC secret for cron job authentication

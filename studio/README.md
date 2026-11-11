# Nikadi Studio

A web application for designing, managing, and distributing personalised event invitation cards — with built-in WhatsApp, SMS, and QR-code delivery.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Step 1 — Clone the Repository](#step-1--clone-the-repository)
6. [Step 2 — Install Dependencies](#step-2--install-dependencies)
7. [Step 3 — Set Up Supabase](#step-3--set-up-supabase)
8. [Step 4 — Configure Environment Variables](#step-4--configure-environment-variables)
9. [Step 5 — Run the Database Schema](#step-5--run-the-database-schema)
10. [Step 6 — Run in Development](#step-6--run-in-development)
11. [Step 7 — Build for Production](#step-7--build-for-production)
12. [Step 8 — Deploy the Messaging Edge Functions (Production Only)](#step-8--deploy-the-messaging-edge-functions-production-only)
13. [Step 9 — Turn On Scheduled Sends](#step-9--turn-on-scheduled-sends)
14. [Step 10 — Turn On Delivery Reports](#step-10--turn-on-delivery-reports)
15. [Step 11 — Turn On the Data Cleaner (Gemini)](#step-11--turn-on-the-data-cleaner-gemini)
16. [Features](#features)
16. [SMS Integration](#sms-integration)
17. [WhatsApp Integration](#whatsapp-integration)
18. [Scheduled Sends](#scheduled-sends)
19. [Card Design System](#card-design-system)
20. [Database Tables](#database-tables)
21. [Known Limitations](#known-limitations)

---

## Overview

Nikadi Studio lets you:

- Create a card design with a background image and draggable elements (name, card type, QR code, etc.)
- Import attendee/contact lists from Excel or CSV
- Send personalised card images via WhatsApp
- Send personalised SMS messages via the messaging-service.co.tz API
- Track WhatsApp and SMS delivery statuses per contact
- Save and reuse card templates
- Leads & customers — record enquiries (name, phone, event type and date, package 800 / 1k / 1.2k / 1.5k or a custom price, region, venue, description), log follow-ups with next-follow-up reminders, qualify a lead into a customer (and its event); each customer can have many events, and an event's Overview shows its customer, lead, follow-ups, sending stats and history together
- Event history — a permanent log of every card and SMS sent (with result, time and who sent it), card uploads and event changes, filterable and exportable to Excel
- Light and dark mode — follows your browser/OS setting by default, or pick one with the header toggle
- Store all events and contacts in a Supabase database

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19, Vite 8 |
| Database | Supabase (PostgreSQL) |
| SMS API | messaging-service.co.tz |
| QR Codes | api.qrserver.com |
| Image Export | Canvas API |
| Data Import | SheetJS (xlsx) |
| Styling | Inline CSS-in-JS (no external CSS framework) |

---

## Project Structure

```
studio/
├── src/
│   ├── App.jsx               # Application UI + state (single-file architecture)
│   ├── LoginPage.jsx         # Google sign-in gate
│   └── lib/
│       ├── supabase.js       # Supabase client
│       ├── phone.js          # Phone normalisation / validation (unit-tested)
│       └── recipients.js     # Bulk-send recipient selection (unit-tested)
├── supabase/
│   └── functions/
│       ├── _shared/proxy.ts  # Auth + endpoint allowlist shared by both proxies
│       ├── send-sms/         # Supabase Edge Function — SMS proxy (production)
│       └── send-wa/          # Supabase Edge Function — WhatsApp proxy (production)
├── public/                   # Static assets
├── supabase-schema.sql       # Database schema, RLS and storage (run in Supabase)
├── vite.config.js            # Vite config with SMS/WhatsApp dev proxies
├── .env.local                # Public config (not committed)
├── .env.development.local    # Dev-only provider tokens (not committed)
└── package.json
```

---

## Prerequisites

Make sure you have the following installed before starting:

- **Node.js** v18 or higher — [nodejs.org](https://nodejs.org)
- **npm** v9 or higher (comes with Node.js)
- A **Supabase** account — [supabase.com](https://supabase.com)
- A **messaging-service.co.tz** account with an API Bearer token

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/your-username/v1-Nikadi-Studio.git
cd v1-Nikadi-Studio/studio
```

---

## Step 2 — Install Dependencies

```bash
npm install
```

This installs:
- `react` and `react-dom`
- `@supabase/supabase-js`
- Vite and ESLint dev tools

---

## Step 3 — Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Choose a region close to Tanzania (e.g. **South Asia** or **Europe West**).
3. Wait for the project to be ready (about 1–2 minutes).
4. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **anon / public key**
5. Go to **Storage → New Bucket**:
   - Name: `templates`
   - Toggle **Public bucket** to ON
   - Click **Save**

---

## Step 4 — Configure Environment Variables

Copy `.env.example` to `.env.local` in the `studio/` folder:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_SMS_SENDER_ID=NIKADI
```

Replace the Supabase values with the ones you copied from Supabase in Step 3.

For **local development only**, put the messaging-service.co.tz bearer token in a separate `.env.development.local`:

```env
VITE_SMS_BEARER_TOKEN=your-messaging-service-bearer-token
VITE_WA_BEARER_TOKEN=your-messaging-service-bearer-token
```

Vite only loads that file for `npm run dev`, never for `npm run build`. **Never put the provider token in `.env.local`** — every `VITE_` value present at build time is baked into the public JavaScript bundle. In production the token lives in Supabase secrets (Step 8) and the browser only ever sends the signed-in user's session.

> `.env.local` and `.env.development.local` are git-ignored (`*.local`) and will never be committed.

---

## Step 5 — Run the Database Schema

1. In your Supabase dashboard, go to **SQL Editor → New Query**.
2. Open the file `supabase-schema.sql` from this project.
3. Paste the entire contents into the SQL editor.
4. Click **Run**.

This creates three tables:

| Table | Purpose |
|---|---|
| `events` | One row per event (name, venue, dates, card design) |
| `event_cards` | One row per contact/attendee per event |
| `saved_templates` | Reusable card designs |

It also sets up:
- Row Level Security (RLS) so **only signed-in users** can read or write any table (it removes the old open-to-everyone policies if you ran an earlier version of this script)
- Indexes for performance
- The `templates` and `wa-cards` storage buckets, with file-size and MIME-type limits and sign-in-only uploads (`wa-cards` must stay public: the WhatsApp provider downloads each card by URL)

The script is safe to re-run. After running it:

1. Go to **Authentication → Sign In / Providers** and turn **off "Allow new users to sign up"**, then invite your team. RLS gives every signed-in user access to every event, so who can sign in is your access control.
2. Go to **Storage → Policies** and delete any leftover `anon`/`public` policy on `wa-cards` that you may have created by hand earlier.

---

## Step 6 — Run in Development

```bash
npm run dev
```

The app opens at `http://localhost:5173`.

The Vite dev server is pre-configured with a proxy so the SMS API calls work from the browser without CORS errors:

```
/sms-proxy/* → https://messaging-service.co.tz/*
/wa-proxy/*  → https://messaging-service.co.tz/*
```

These proxies are active **only in development**. For production see Step 8.

---

## Step 7 — Build for Production

```bash
npm run build
```

The compiled output goes to `dist/`. Serve it with any static host (Netlify, Vercel, Nginx, etc.).

### Deploy to Heroku (from the GitHub repository)

The repository root holds what Heroku needs: `package.json` (builds `studio/` in `heroku-postbuild`), `Procfile` (`web: node server.js`), `server.js` (a dependency-free static server for `studio/dist` with gzip, caching, HTTPS redirect and single-page-app fallback) and `app.json`.

1. **Create the app.** In the Heroku dashboard: **New → Create new app** (pick the Europe region if most users are in Tanzania).
2. **Set the config vars** (Settings → Config Vars). They are read at **build** time and baked into the browser bundle, so only public values go here:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |
   | `VITE_SITE_URL` | `https://<your-app>.herokuapp.com/` (or your own domain, with the trailing `/`) |
   | `VITE_SMS_SENDER_ID` | `NIKADI` (optional fallback) |

   Never add `VITE_SMS_BEARER_TOKEN` / `VITE_WA_BEARER_TOKEN` — provider tokens live only in the Supabase Edge Function secrets.
3. **Connect GitHub.** Deploy tab → **Deployment method: GitHub** → find `v1-Nikadi-Studio` → **Connect**. Under *Automatic deploys* choose branch `main` and click **Enable Automatic Deploys** (optionally tick *Wait for CI to pass*). Then **Deploy Branch** once to build now.
4. **Let users sign in on the new address.** Supabase → Authentication → URL Configuration: add `https://<your-app>.herokuapp.com` to **Redirect URLs** (and set it as **Site URL** if Heroku is now the main address). In Google Cloud, the OAuth client's redirect stays the Supabase callback, so nothing changes there.
5. **Allow the app to call the messaging functions.** If you set `ALLOWED_ORIGINS` for the Edge Functions (Step 8.2), add the Heroku origin:
   ```bash
   supabase secrets set ALLOWED_ORIGINS="https://<your-app>.herokuapp.com,https://<github-user>.github.io"
   ```
6. **Check it.** Open `https://<your-app>.herokuapp.com/healthz` (should say `ok`), then the app itself, sign in, and open an event.

Notes
- After changing any `VITE_*` config var, redeploy (Deploy → **Deploy Branch**) — the values are fixed at build time.
- GitHub Pages is no longer used. `.github/workflows/ci.yml` only checks the code (lint, tests, build); in Heroku tick **Wait for CI to pass before deploy**. If Pages was turned on earlier, set GitHub → Settings → Pages → Source to **None** (or unpublish) so the old site stops serving.
- Run the same build locally with `npm run build && npm start` from the repository root (serves on port 3000).
- Link previews use `VITE_SITE_URL`; after the first deploy refresh them in Facebook's Sharing Debugger.

---

## Step 8 — Deploy the Messaging Edge Functions (Production Only)

`send-sms` and `send-wa` are server-side proxies for the messaging API. They exist because the provider has no CORS headers and its token must not ship in the browser. Both share [`supabase/functions/_shared/proxy.ts`](supabase/functions/_shared/proxy.ts), which enforces:

- **Sign-in required** — the caller's Supabase access token is verified; the bare anon key is rejected.
- **Endpoint allowlist** — only the specific provider endpoints the app uses are reachable.
- **Server-side token** — the provider token comes from a Supabase secret and is never accepted from, or returned to, the browser.

### 8.1 — Log in to the Supabase CLI

```bash
npx supabase login
```

### 8.2 — Set the secrets

```bash
npx supabase secrets set SMS_BEARER_TOKEN=your-messaging-service-bearer-token \
  --project-ref your-project-ref

# Optional: only if WhatsApp uses a different token from SMS
npx supabase secrets set WA_BEARER_TOKEN=your-whatsapp-bearer-token \
  --project-ref your-project-ref

# Recommended: only allow your app's origin(s) to call the functions from a browser
npx supabase secrets set ALLOWED_ORIGINS=https://your-app-domain.example \
  --project-ref your-project-ref
```

### 8.3 — Deploy both functions

```bash
npx supabase functions deploy send-sms --project-ref your-project-ref --no-verify-jwt
npx supabase functions deploy send-wa  --project-ref your-project-ref --no-verify-jwt
```

`--no-verify-jwt` is intentional: Supabase's publishable keys are not JWTs, so the gateway's legacy check would reject them. The functions perform their own, stricter, check (a valid signed-in user session).

### 8.4 — Verify

Signed out, this must be rejected:

```bash
curl -i -X POST https://your-project-ref.supabase.co/functions/v1/send-sms/api/sms/v2/text/single
# HTTP/2 401  {"error":"Sign in required"}
```

Then sign in to the app and use the SMS balance button — it should load.

### 8.5 — Test the functions locally (optional)

```bash
npm run test:functions   # needs Node 22.18+; mocks Deno and fetch, no Supabase needed
```

---

## Step 9 — Turn On Scheduled Sends

Scheduled SMS / WhatsApp sends (see [Scheduled Sends](#scheduled-sends)) are sent by the Supabase server, not the browser: every minute, while a send is due, the `pg_cron` extension calls the `run-schedules` Edge Function through `pg_net`. This is a one-time setup. Run the commands from the `studio` folder and use your project ref (`cixtbtzxlnohxgeewtqc` for the live project).

### 9.1 — Run the schema

Run the latest `supabase-schema.sql` (Step 5). It creates the schedule tables and functions, switches on `pg_cron` and `pg_net` when your plan allows it, and registers the job `nikadi-run-schedules`. If you see the notice *"Scheduled sends: could not set up pg_cron / pg_net"*, turn both on under **Database → Extensions** and run the file again.

### 9.2 — Create the shared secret

The job proves itself to the function with a long random secret. Make one, for example in PowerShell:

```powershell
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

Give the same value to the function and to the database:

```bash
npx supabase secrets set CRON_SECRET=<the-secret> --project-ref <your-project-ref>
```

Then, in the Supabase **SQL Editor** (run it once and don't save it in a file, because it holds the secret):

```sql
select vault.create_secret('https://<your-project-ref>.supabase.co', 'nikadi_project_url');
select vault.create_secret('<the-secret>', 'nikadi_cron_secret');
```

To change the secret later, run `select vault.update_secret((select id from vault.secrets where name = 'nikadi_cron_secret'), '<new-secret>');` and set `CRON_SECRET` to the same value.

### 9.3 — Deploy the function

```bash
npx supabase functions deploy run-schedules --project-ref <your-project-ref> --no-verify-jwt
```

It uses the same `SMS_BEARER_TOKEN` (and optional `WA_BEARER_TOKEN`) as Step 8. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase automatically. `--no-verify-jwt` is needed because the caller is the database, not a signed-in user. The function checks `x-cron-secret` instead and refuses everything else.

### 9.4 — Check it works

Schedule a one-time SMS to your own number a few minutes ahead (SMS tab → **Scheduled SMS → New schedule**). After the time has passed:

```sql
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, content from net._http_response order by created desc limit 5;
```

`status_code` 200 with `"state":"done"` means it was sent. A 401 means the two secrets differ, and a 404 means the function isn't deployed. The job only calls the function while a send is due, so these tables stay quiet the rest of the time.

---

## Step 10 — Turn On Delivery Reports

Sending only tells you NextSMS **accepted** a message ("Sent"). Whether it reached the phone comes later, as a delivery report: **Delivered**, **Read** (WhatsApp) or **Failed**, with the reason (e.g. "UNDELIVERABLE — the number may not exist"). The app collects these reports in three ways:

- **Webhook (instant):** NextSMS posts each result to the `delivery-webhook` function.
- **Server check:** every 5 minutes, `run-schedules` asks NextSMS for messages still waiting. This covers missed webhooks; NextSMS doesn't retry them.
- **"Check delivery now"** in the Reports tab.

Every send is stored with its NextSMS message id in `message_deliveries`. Each result updates the guest's status and is written to the event History. The cron job also needs the Step 9 setup (pg_cron, pg_net, the Vault secrets and `CRON_SECRET`).

### 10.1 — Run the schema

Run the latest `supabase-schema.sql` (Step 5). It adds the delivery table and functions, and the cron job `nikadi-sync-deliveries`.

### 10.2 — Set the webhook token and deploy

Make a long random **Verify Token**, for example `[guid]::NewGuid().ToString("N")` in PowerShell. Then:

```bash
npx supabase secrets set NEXTSMS_CALLBACK_TOKEN=<the-token> --project-ref <your-project-ref>
npx supabase functions deploy delivery-webhook --project-ref <your-project-ref> --no-verify-jwt
# Redeploy these three too, so they record message ids and allow the reports / log lookups
npx supabase functions deploy run-schedules --project-ref <your-project-ref> --no-verify-jwt
npx supabase functions deploy send-sms      --project-ref <your-project-ref> --no-verify-jwt
npx supabase functions deploy send-wa       --project-ref <your-project-ref> --no-verify-jwt
```

### 10.3 — Point NextSMS at the webhook

In the NextSMS dashboard go to **Customer Profile** (top-right menu) → **Customization** → **Webhooks**, and set:

- **Delivery Callback URL:** `https://<your-project-ref>.supabase.co/functions/v1/delivery-webhook`
- **Verify Token:** the same token as `NEXTSMS_CALLBACK_TOKEN`

NextSMS sends a test request when you save. The function answers it with 200. Only messages sent **after** you save get webhooks; older ones are picked up by the server check (for up to 3 days after sending).

### 10.4 — Check it works

Send an SMS to your own number, and one to a number that doesn't exist (for example `255700000000`). Within a minute or so, the Reports tab shows the first as **Delivered** and the second as **Failed**, with the reason. The Delivery log lists both with "via webhook" or "via check". If nothing changes:

```sql
select status, status_name, source, sent_at, done_at, checks from message_deliveries order by sent_at desc limit 10;
select status_code, content from net._http_response order by created desc limit 5;   -- the server checks
```

- **The row is missing:** `record_message_sends` isn't installed (run the schema), or `send-sms` / `send-wa` weren't redeployed.
- **The row stays `sent` with `checks` growing:** NextSMS hasn't reported yet. Check that its URL and token match.

---

## Step 11 — Turn On the Data Cleaner (Gemini)

The **Clean data** button floats over the Studio pages (Design, VCard, SMS, WhatsApp, Batch & Send). It opens a chat where you paste a messy guest list (or attach photos of one) and Google Gemini returns clean tables of Name, Phone and card type. The browser never sees the Gemini key: it calls the `ai-clean` Edge Function, which holds the key and the bot's fixed instructions (`supabase/functions/_shared/dataClean.js`).

### 11.1 — Get a Gemini API key

Create one in [Google AI Studio](https://aistudio.google.com/apikey).

### 11.2 — Set the secret and deploy

```bash
npx supabase secrets set GEMINI_API_KEY=<your-gemini-key> --project-ref <your-project-ref>
# Optional: pin a model. Default: gemini-flash-lite-latest (Google's current Flash-Lite;
# in Nov 2026 the bigger Flash models were too slow or "unavailable" for this)
npx supabase secrets set GEMINI_MODEL=<model-name> --project-ref <your-project-ref>
npx supabase functions deploy ai-clean --project-ref <your-project-ref> --no-verify-jwt
```

Like the messaging functions, it accepts only signed-in users whose role can see a Studio page.

### 11.3 — In development

Put the key in `.env.development.local` **without** the `VITE_` prefix, so it stays on your machine and out of the bundle, then restart `npm run dev`:

```bash
GEMINI_API_KEY=<your-gemini-key>
```

The Vite dev server answers `/ai-clean` itself with the same instructions and checks.

---

## Features

### Events

- Create a named event with type (e.g. Wedding, Michango, Corporate)
- Set venue name, address, date/time range
- Upload a cover image for the card background
- Save the event to Supabase and reopen it later from the Events list

### Feedback

Everyone can press **Feedback** in the header (or *Send feedback* in the phone menu) to report a problem, share an idea, ask a question or give praise, with an optional 1–5 star rating. The page they were on, the open event and their device are attached, so the team can follow up. **My feedback** shows what they sent and the team's reply; they can edit it until the team has seen it.

The **Feedback** page (Admin by default; set it per role under Settings → Roles & permissions) lists everything with counts and filters. The team can set each item to New, Seen, Planned, Done or Won't do, reply, and export to Excel. Only Super Admins can delete feedback.

### Card Design

- Background image uploaded from your computer or URL
- Draggable, resizable elements:
  - **Name** — personalised per contact
  - **Card Type** — e.g. SINGLE, DOUBLE, STAFF, VIP
  - **QR Code** — generated per contact linking to their card data
  - **Date / Venue** — from event details
  - **Logo / Custom image**
- Font size, colour, and position are all adjustable
- Michango (contribution) event type hides QR code and card type automatically

### Contacts

- Import from **Excel (.xlsx)** or **CSV** — columns auto-detected (`name`, `phone`, `cardType`, etc.)
- Add or remove contacts manually
- Each contact has a WhatsApp status and SMS status tracked independently
- Uploading a new spreadsheet in Design for an event that already has guests **resets every guest's WhatsApp card and main SMS status to "not sent"**, so the new list can be sent to everyone. Calls, check-ins, extra SMS messages and card images are kept, and guests are still matched by phone and name. The list then holds only the sheet's guests, so **Send All, Download All and the counts** go by the uploaded records: guests left off the sheet who have call or check-in history stay only in Calls, Scanner and History (no cards or messages, including scheduled sends), and come back if a later sheet has them. The reset is stored by **Save Cards** (with a History entry). Delivery reports of messages sent before the reset no longer change the guests (needs the latest `supabase-roles-settings-scan.sql`)
- Importing guests on the **Calls** or **Scanner** tab only adds: a row is skipped when its **Name, Phone and Card type** all match a saved guest (or an earlier row in the file). The same name and phone with another card type is added as a new card
- **Super Admins** can delete a guest card that is no longer used, from the Calls and Scanner guest lists (trash button). It removes the guest from the event everywhere, including their check-ins, and History records who deleted it. A printed QR for that card no longer works at the door (needs the latest `supabase-roles-settings-scan.sql`)
- Export contacts as CSV

### Data Cleaner (AI)

- The floating **Clean data** button on the Studio pages opens a chat with Google Gemini (setup: Step 11)
- Paste a messy list (a WhatsApp message, a typed list, rows from Excel) and get clean tables: list numbers, symbols and words like "simu no." removed; phones as `07…`; names in Title Case with "Mr. & Mrs."; card types as DOUBLE / SINGLE (or *Haikutajwa* when not given)
- Or attach photos and screenshots of a list, up to 10 per message (the photo button, paste a screenshot, or drag photos onto the chat). Each photo is read on its own and the results are joined into one list; a guest seen on two overlapping screenshots is listed once
- Photos are never saved: they are shrunk in your browser, kept only in memory with the chat, and sent to Gemini only inside the question. Nothing goes to Storage, the database or browser storage, and New chat or a reload drops them. Numbers read from a photo can't be checked against typed text, so check them against the photos (a digit the AI couldn't read shows as `?`, marked in red)
- Ask for changes in the same chat ("ongeza…", "ondoa…")
- Long one-guest-per-line lists are cleaned in parts of 40 lines (the AI drops or garbles a few guests in one long answer), then joined into one list
- Every answer is checked in code against what you pasted, and problems are marked in red: numbers missing from the table, numbers that aren't in your list (a slipped digit), numbers not in the 0… format, and card types that differ from your list (**Use the card types from my list** fixes those in one click)
- **Use as guest list** loads the result like an uploaded spreadsheet (WhatsApp and SMS statuses are reset; saved guests keep their calls and check-ins; nothing is saved until **Save Cards**). Or download it as **Excel** or **Copy** it as rows
- The bot only cleans guest lists: its instructions are fixed on the server
- The chat is kept in memory only (it holds phone numbers) and is cleared on reload

### Templates

- Save the current card design (background + element layout) as a named template
- Load any saved template to apply it to a new event
- Templates are stored in Supabase Storage (`templates` bucket) and the `saved_templates` table

### VCard

- Generate `.vcf` VCard files for contacts
- Download all contacts as a single VCard file for easy import into phone contacts

---

## SMS Integration

Nikadi Studio uses the [messaging-service.co.tz](https://messaging-service.co.tz) REST API (Messaging Service API V2).

### Authentication

```
Authorization: Bearer <your-messaging-service-bearer-token>
```

In development, the token comes from `VITE_SMS_BEARER_TOKEN` / `VITE_WA_BEARER_TOKEN` in `.env.development.local` (see Step 4). In production the browser sends the signed-in user's Supabase session instead, and the Edge Function verifies it and attaches the `SMS_BEARER_TOKEN` secret (see Step 8.2) — the provider token never reaches the browser.

### Endpoints Used

| Purpose | Method | Endpoint |
|---|---|---|
| Send single SMS | POST | `/api/sms/v2/text/single` |
| Send bulk SMS | POST | `/api/sms/v2/text/multi` |
| Check SMS balance | GET | `/api/v2/balance` |

### SMS Tab Features

| Feature | Description |
|---|---|
| **Message editor** | Compose the SMS with `{name}` and `{cardType}` template variables |
| **Multiple messages** | **＋ Add message** creates extra messages per event (e.g. reminder, thank-you), each with its own title, text and send status. They auto-save to `events.sms_messages` |
| **Recipients per message** | An extra message goes to the event contacts or to its own uploaded Excel/CSV list (or the list loaded in the VCard tab). Every column of that list becomes a `{Column}` placeholder for that message |
| **iPhone mockup** | Live preview of how the SMS looks on iPhone — scrollable for long messages |
| **Cost calculator** | Shows characters, SMS parts per message, contacts with phone, total credits needed, and estimated cost in TZS (credits × 16) |
| **Remaining SMS panel** | Fetches your account balance and displays SMS remaining (`balance ÷ 16`) with channel info |
| **Send to All** | Uses the bulk `/text/multi` endpoint — sends all contacts in one request |
| **Send per row** | Send to individual contacts using the Send button per row |
| **Status tracking** | Each contact shows `○ Pending` → `↑ Sent` → `✓ Delivered` / `✗ Failed` |
| **Send Log** | Live log panel showing send progress with `✓✓ delivered`, `↑ sent`, `✗ failed` icons |
| **Download CSV** | Export phone numbers and personalised messages for use in other tools |

### Sender ID

The default Sender ID is `NIKADI`. This is the name that appears on the recipient's phone instead of a phone number.

### Phone Number Format

All phone numbers are normalised to E.164 format without the `+` sign:

- `0712345678` → `255712345678`
- `+255712345678` → `255712345678`
- `255712345678` → `255712345678`
- `712345678` → `255712345678` (Excel drops the leading `0` from numeric phone cells)

Numbers that are not 11–15 digits after normalising are treated as invalid and skipped by bulk sends.

### SMS Status Values

NextSMS status **ids** decide the status, not the group. Group 20 holds both DELIVERED and failures such as UNDELIVERABLE, so the group alone can't tell. The full table is `PROVIDER_STATUS` in `supabase/functions/_shared/messaging.js`, mirrored by `delivery_state()` in SQL.

| Status | NextSMS status ids | Meaning |
|---|---|---|
| Pending | — | Not yet sent |
| Sent (waiting) | 50, 51 ENROUTE, 52, 77 ACCEPTED, 88; WhatsApp 109 SENT | Accepted by NextSMS, waiting for the delivery report. This is the normal answer to a send. |
| Delivered | 73 | On the phone |
| Read (WhatsApp) | 108 | Opened |
| Failed | 74 EXPIRED, 75, 76 UNDELIVERABLE, 78, 79 REJECTED, 80 SKIPPED, 112, 114, 120; every 19 / 22 id (e.g. 58 FAILED_SENDER, 57 no credit) | Not delivered. The reason is shown in the badge tooltip, the Reports tab and History. |

On WhatsApp, 76, 111 and 120 show as **Not on WhatsApp**.

### CORS Note

The SMS API does not allow direct browser requests (no CORS headers). In development, Vite proxies all `/sms-proxy/*` requests server-side. In production, the Supabase Edge Functions (`send-sms`, `send-wa`) act as the proxy and require a signed-in user.

---

## WhatsApp Integration

WhatsApp messages are sent as **template messages with the personalised card as the image header**, through the messaging-service.co.tz WhatsApp API (`POST /api/whatsapp/v2/text/single`).

### Flow

1. **Upload cards** — each contact's card is rendered, compressed to JPEG and uploaded to the public `wa-cards` Storage bucket. The public URL is kept on the contact. (Available as ☁ **Upload** per row on both the WhatsApp and Batch & Send tabs, or **Upload All Cards**.)
2. **Send** — the template (e.g. `Mwaliko`) is sent with that URL as the header image, one contact at a time with a 1 s delay.
3. **Track** — the send answer is usually `Sent`, meaning it is on its way. The delivery report then moves it to `Delivered`, `Read`, `Not on WhatsApp` or `Not Sent`, through the webhook, the server check and quick checks right after sending (Step 10). A `.xlsx` report can be downloaded after a bulk send.

Progress for uploads, WhatsApp sends and SMS sends appears in a floating log panel in the bottom-left corner. It never moves the page, stays while a run is still in progress, and disappears by itself 5 seconds after the run finishes (✕ closes it sooner). Toast notifications also stay for 5 seconds. The per-contact status columns and the WhatsApp report keep the results after the log is gone.

### Safeguards

- Bulk sends (WhatsApp and SMS) open a confirmation window showing how many contacts will be messaged, and skip contacts already sent and contacts without a valid number.
- If several contacts share a phone number, that window lists them and lets you choose **Send without duplicates** (each number once) or **Send duplicates too** (every record).
- Sending to a contact that was already sent asks first.
- A card is never rendered without its QR code: if the QR image or template can't be loaded the export fails with a clear message instead of producing an incomplete card.
- Uploaded card URLs are saved with the guest (`event_cards.card_url`), so they survive a reload. They are cleared when the card template changes or when Settings → Storage clears the images, and the cards must then be uploaded again.

---

## Scheduled Sends

The **Schedules** page lists every schedule of every event you can see. It has filters (search, SMS / WhatsApp, status, event), counts (active, paused, sends today and in the next 7 days, finished), and buttons to **create, view, edit, pause, resume, cancel** and, for Super Admins, **delete**. The SMS and WhatsApp tabs also each have a **Scheduled** panel for the open event. Use it to plan sends ahead:

- **Pick dates**: one or more exact dates and times.
- **Repeat weekly**: choose days (e.g. Mon, Wed, Fri) and a time, repeat every 1–8 weeks, and stop after a number of sends (e.g. 30) or on a date (the event date by default). "3 a week, 30 times" is Mon/Wed/Fri with 30 sends; "3 times, every two weeks" is one day with *every 2 weeks* and 3 sends.
- **Who gets it**:
  - everyone
  - not sent yet (main SMS / WhatsApp card only)
  - guests who said Yes on calls
  - everyone except No

  Each send uses the guest list as it is at that moment, so guests added later are included.
- **What**:
  - SMS: the main message, an extra message or custom text, with `{name}`, `{cardType}` and `{phone}`.
  - WhatsApp: a template. A template with an image header sends each guest's uploaded card, and guests without one are skipped. A text-only template sends a plain reminder.

The form refuses dates and times that have already passed (the server checks again). It allows at most 100 sends per schedule, and it previews every send time, the number of guests and the SMS cost. The **Edit**, **Pause**, **Resume** and **Cancel** controls are in the schedule's window, next to the result of every send. Sends that came due while a schedule was paused, or more than 2 hours late, are skipped instead of sent late. Main-SMS and card schedules update the guests' statuses like **Send All**. Every send is also written to the event History.

**Who sends an SMS schedule** is chosen when it is made:

- **NextSMS schedules it** (the default):
  - **On save:** every send time goes to NextSMS straight away, through the same route as **Send All**, as a normal bulk send with a date and time in East Africa Time. NextSMS holds the messages and sends each at its time, with no server scheduler or Vault secrets involved.
  - **Fixed once saved:** NextSMS's API cannot cancel, pause or change a held message, so these schedules have no Edit, Pause or Cancel. The guest list and texts are fixed when you save.
  - **Status:** each send time shows **With NextSMS** until its time passes, then **Sent**. Every message's real result comes from the delivery reports.
  - **If NextSMS refuses a send time** (e.g. no credit, or a duplicate within 24 hours), the remaining send times aren't handed over, and the reason is shown on each one.
- **Nikadi server**: the `run-schedules` function sends at each time. Can be paused, cancelled and edited; needs [Step 9](#step-9--turn-on-scheduled-sends).

WhatsApp schedules are always sent by the server, because NextSMS can't hold a WhatsApp card for later.

The schedules live in `message_schedules` / `message_schedule_runs`. The browser works out every send time and saves them through `save_message_schedule()`. The `run-schedules` Edge Function sends what is due: SMS in batches of 100, WhatsApp one at a time, about 25–30 per minute. Larger WhatsApp sends continue over the next minutes. Setup: [Step 9](#step-9--turn-on-scheduled-sends).

---

## Card Design System

Cards are rendered on an HTML Canvas element. The design is made up of **elements** — each element has:

- `id` — unique identifier (`name`, `cardtype`, `qr`, `date`, `venue`, `logo`, etc.)
- `x`, `y` — position as percentage of canvas width/height
- `w`, `h` — size as percentage
- `fontSize`, `color` — text styling
- `visible` — whether the element is shown on the canvas

The canvas is exported as a PNG image using `canvas.toDataURL("image/png")`.

---

## Database Tables

### `events`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `username` | TEXT | Event creator name |
| `phone` | TEXT | Contact phone |
| `event_type` | TEXT | e.g. Wedding, Michango |
| `status` | TEXT | `active` or `completed` |
| `venue_name` | TEXT | Venue name |
| `venue_address` | TEXT | Venue address |
| `start_datetime` | TIMESTAMPTZ | Event start |
| `end_datetime` | TIMESTAMPTZ | Event end |
| `cover_image_url` | TEXT | Card background image URL |
| `elements_layout` | JSONB | Card element positions and styles |
| `sms_message` | TEXT | Main SMS message template |
| `sms_draft` | TEXT | Autosaved working copy of the main SMS message |
| `sms_messages` | JSONB | Extra SMS messages: title, text, recipient source (contacts or uploaded list) and per-message statuses |

### `leads`, `lead_followups`, `customers`

| Table | Key columns |
|---|---|
| `leads` | `name`, `phone`, `event_type`, `event_date`, `package_price` (TZS), `region`, `venue`, `description`, `status` (`new` / `contacted` / `qualified` / `lost`), `next_followup_date`, `customer_id`, `event_id`, `qualified_at`, `created_by` |
| `lead_followups` | `lead_id` (deleted with the lead), `method` (call / whatsapp / sms / meeting / other), `note`, `next_followup_date`, `created_by` |
| `customers` | `name`, `phone`, `region`, `notes`, `created_by` |

`events` also has `customer_id`, `lead_id`, `package_price` and `region`. Deleting a customer or lead keeps the events and only removes the link.

### `event_logs`

Append-only history (signed-in users can add and read rows, never edit or delete them).

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `event_id` | UUID | Foreign key → events (deleted with the event) |
| `created_at` | TIMESTAMPTZ | When it happened |
| `user_email` | TEXT | Who did it (set by the database from the login) |
| `channel` | TEXT | `whatsapp`, `sms`, `card` or `event` |
| `action` | TEXT | `send`, `status` (late delivery report), `upload`, `bulk`, `create`, `update`, `contacts` |
| `status` | TEXT | `sent`, `delivered`, `invalid`, `not_sent`, `failed` or `ok` |
| `recipient_name` / `recipient_phone` | TEXT | Who it was sent to |
| `message_title` | TEXT | SMS message title or WhatsApp template |
| `detail` | TEXT | Error or summary text |

### `event_cards`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `event_id` | UUID | Foreign key → events |
| `name` | TEXT | Contact name |
| `card_type` | TEXT | e.g. SINGLE, VIP, STAFF |
| `phone` | TEXT | Phone number |
| `wa_status` | TEXT | `idle`, `testing`, `yes`, `no` |
| `sms_status` | TEXT | `pending`, `sent`, `delivered`, `failed` |
| `card_url` | TEXT | Public URL of the guest's uploaded card image (`wa-cards` bucket); used by WhatsApp sends, including scheduled ones |
| `sent_at` | TIMESTAMPTZ | When the card was sent |

### `saved_templates`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | TEXT | Template display name |
| `cover_image_url` | TEXT | Background image URL in Storage |
| `elements_layout` | JSONB | Saved element positions and styles |

---

## Known Limitations

- **Single-file architecture** — the UI and state live in `src/App.jsx` (pure logic is being moved to `src/lib/`). This works for a focused internal tool but will need splitting if the codebase grows.
- **No per-user data ownership** — authentication is Google sign-in via Supabase and RLS requires a signed-in user, but every signed-in user can see every event. Restrict who can sign in (Step 5) until ownership is added.
- **QR codes are not signed** — a card's QR encodes only `Name=…;TypeCard=…`, so it can be reproduced by anyone and must not be treated as proof of entitlement. QR images are generated by `api.qrserver.com`, which therefore receives each guest's name and card type.
- **Scheduled WhatsApp sends are paced** — about 25–30 cards a minute (1 s between messages, as in the app), so a 500-guest send takes around 20 minutes.
- **Delivery reports have limits:**
  - They arrive by webhook as soon as NextSMS has them. The server check covers any it missed, for 3 days after sending.
  - A message still waiting after 3 days stays "Sent (waiting)". Look it up in the NextSMS log.
  - Webhooks work only for messages sent after the callback URL was saved in the NextSMS dashboard.
  - Extra SMS messages keep their delivery result in `message_deliveries`; the app shows it on top of the message's stored statuses.
- **Card images are kept forever** — files in `wa-cards` are never cleaned up; they are public by URL so the WhatsApp provider can fetch them.
- **No rate limiting on the Edge Functions** — they require sign-in and an allowlisted endpoint, but a signed-in user can still send as many messages as the provider account allows.

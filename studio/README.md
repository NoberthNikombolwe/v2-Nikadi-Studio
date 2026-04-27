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
12. [Step 8 — Deploy SMS Edge Function (Production Only)](#step-8--deploy-sms-edge-function-production-only)
13. [Features](#features)
14. [SMS Integration](#sms-integration)
15. [WhatsApp Integration](#whatsapp-integration)
16. [Card Design System](#card-design-system)
17. [Database Tables](#database-tables)
18. [Known Limitations](#known-limitations)

---

## Overview

Nikadi Studio lets you:

- Create a card design with a background image and draggable elements (name, card type, QR code, etc.)
- Import attendee/contact lists from Excel or CSV
- Send personalised card images via WhatsApp
- Send personalised SMS messages via the messaging-service.co.tz API
- Track WhatsApp and SMS delivery statuses per contact
- Save and reuse card templates
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
│   └── App.jsx               # Entire application (single-file architecture)
├── supabase/
│   └── functions/
│       └── send-sms/
│           └── index.ts      # Supabase Edge Function — SMS proxy (production)
├── public/                   # Static assets
├── supabase-schema.sql       # Database schema (run once in Supabase)
├── vite.config.js            # Vite config with SMS dev proxy
├── .env.local                # Environment variables (not committed)
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

Create a file named `.env.local` in the `studio/` folder:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Replace the values with the ones you copied from Supabase in Step 3.

> `.env.local` is listed in `.gitignore` and will never be committed to git.

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
- Row Level Security (RLS) policies (open read/write for internal use)
- Indexes for performance
- The `templates` storage bucket (if not already created)

---

## Step 6 — Run in Development

```bash
npm run dev
```

The app opens at `http://localhost:5173`.

The Vite dev server is pre-configured with a proxy so the SMS API calls work from the browser without CORS errors:

```
/sms-proxy/* → https://messaging-service.co.tz/*
```

This proxy is active **only in development**. For production see Step 8.

---

## Step 7 — Build for Production

```bash
npm run build
```

The compiled output goes to `dist/`. Serve it with any static host (Netlify, Vercel, Nginx, etc.).

To preview the production build locally:

```bash
npm run preview
```

> In a production build, SMS calls are routed through the Supabase Edge Function. Make sure you have completed Step 8 before deploying.

---

## Step 8 — Deploy SMS Edge Function (Production Only)

The Edge Function (`supabase/functions/send-sms/index.ts`) acts as a server-side proxy for the SMS API, bypassing browser CORS restrictions.

### 8.1 — Install Supabase CLI

```bash
npm install -g supabase
```

Or use `npx supabase` for one-off commands without global install.

### 8.2 — Log In

```bash
npx supabase login
```

This opens your browser to authenticate with your Supabase account.

### 8.3 — Deploy the Function

```bash
npx supabase functions deploy send-sms \
  --project-ref your-project-ref \
  --no-verify-jwt
```

Replace `your-project-ref` with the short ID from your Supabase project URL (e.g. `cixtbtzxlnohxgeewtqc`).

### 8.4 — Verify

After deployment the function will be live at:

```
https://your-project-ref.supabase.co/functions/v1/send-sms
```

In production builds, all SMS requests are automatically routed to this URL.

---

## Features

### Events

- Create a named event with type (e.g. Wedding, Michango, Corporate)
- Set venue name, address, date/time range
- Upload a cover image for the card background
- Save the event to Supabase and reopen it later from the Events list

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
- Export contacts as CSV

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
Authorization: Bearer dc677ab4eddbafd7dfb35b115c91a9bc
```

The Bearer token is hardcoded in `App.jsx` (`smsSettings.bearerToken`). To change it, update that constant.

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

### SMS Status Values

| Status | groupId from API | Meaning |
|---|---|---|
| Pending | — | Not yet sent |
| Sent | 18 | Message accepted and enroute to operator |
| Delivered | 20 | Confirmed delivery to handset |
| Failed | 19 or 22 | Rejected or failed |

### CORS Note

The SMS API does not allow direct browser requests (no CORS headers). In development, Vite proxies all `/sms-proxy/*` requests server-side. In production, the Supabase Edge Function (`send-sms`) acts as the proxy.

---

## WhatsApp Integration

WhatsApp sending uses `wa.me` deep links — no API key required.

- Each contact gets a personalised card image exported from Canvas
- The app opens `https://wa.me/{phone}?text={message}` in a new tab
- You confirm or cancel sending in the WhatsApp Web interface
- WhatsApp status is tracked per contact: `Not checked` → `Awaiting` → `On WhatsApp` / `Not on WA`

### Batch Send

The **Batch & Send** tab automates the full flow:

1. Export the card image for each contact
2. Open the WhatsApp link for that contact
3. Wait for you to send, then move to the next contact (1.5 s delay)

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

- **Single-file architecture** — the entire app lives in `src/App.jsx`. This works well for a focused internal tool but will need splitting if the codebase grows significantly.
- **No user authentication** — the app uses the Supabase `anon` key with open RLS policies. It is designed for internal/private use. Do not expose to the public internet without adding auth.
- **WhatsApp sending is semi-manual** — each `wa.me` link opens a browser tab that you must confirm. Full automation requires the WhatsApp Business API.
- **SMS delivery status is immediate only** — the `Delivered` status is based on the API's synchronous response (`groupId: 20`). For asynchronous delivery reports you would need to set up a webhook.
- **Bearer token is client-side** — the SMS API token is embedded in the frontend. For stricter security, move it to a server-side environment variable in the Supabase Edge Function.

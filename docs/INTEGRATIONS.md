# Nikadi Studio — Integrations

**Last updated:** 2026-11-16

---

## 1. Supabase

**Type:** Backend-as-a-Service  
**Used for:** Database, authentication, file storage, real-time, edge functions, cron

### 1.1 Client Setup

```js
// studio/src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

The client is `null` when env vars are missing (guards are required throughout the app).

### 1.2 Services Used

| Service | Usage |
|---------|-------|
| Postgres | All application data |
| Auth | Email/password, invite-only |
| Storage | Card images, templates, fonts, event page images |
| Realtime | Scanner live feed, delivery report streaming |
| Edge Functions | SMS proxy, WA proxy, scheduled sends, AI clean |
| Vault | Provider API secrets |
| pg_cron + pg_net | Scheduled message processing, delivery polling |

### 1.3 SDK Version

`@supabase/supabase-js@^2.104.0`

### 1.4 Supabase CLI

```bash
supabase login
supabase link --project-ref <ref>
supabase functions deploy <function-name>
supabase secrets set KEY=value
```

---

## 2. messaging-service.co.tz

**Type:** SMS and WhatsApp messaging provider  
**Region:** Tanzania

### 2.1 SMS API

Base: `https://messaging-service.co.tz/api/sms/v2/`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/send` | POST | Single SMS |
| `/bulk` | POST | Bulk SMS (array of messages) |
| `/delivery/{groupId}` | GET | Delivery report for a bulk send |

Auth: `Authorization: Bearer <provider_token>`

**Request (single):**
```json
{ "from": "NIKADI", "to": "255712345678", "text": "Habari…" }
```

**Request (bulk):**
```json
{
  "from": "NIKADI",
  "messages": [
    { "to": "255712345678", "text": "Habari Juma…" },
    { "to": "255787654321", "text": "Habari Fatuma…" }
  ]
}
```

**Response:**
```json
{
  "status": "success",
  "groupId": "abc123",
  "count": 2
}
```

### 2.2 WhatsApp API

Base: `https://messaging-service.co.tz/api/wa/v2/`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/send` | POST | Send a WhatsApp message with optional media |
| `/delivery/{messageId}` | GET | Delivery status |

**Request (image with caption):**
```json
{
  "to": "255712345678",
  "type": "image",
  "image": { "url": "https://...public-card.jpg" },
  "caption": "Habari Juma, mwaliko wako uko hapo!"
}
```

### 2.3 Dev Proxy

In development, Vite proxies provider calls:

```js
// vite.config.js
server: {
  proxy: {
    '/sms-proxy': {
      target: 'https://messaging-service.co.tz',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/sms-proxy/, ''),
    },
    '/wa-proxy': {
      target: 'https://messaging-service.co.tz',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/wa-proxy/, ''),
    },
  },
},
```

The dev token comes from `VITE_SMS_BEARER_TOKEN` / `VITE_WA_BEARER_TOKEN` in `.env.development.local`.

### 2.4 Production Proxy

Edge Functions `send-sms` and `send-wa` in `supabase/functions/`:
1. Verify caller has a valid Supabase session
2. Read provider token from Supabase Vault
3. Allowlist the requested provider endpoint
4. Forward the request to the provider

---

## 3. Google Fonts

**Type:** Font CDN  
**Used for:** Card fonts and UI font

```js
// studio/src/lib/fonts.js
export const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?...";
```

The Google Fonts stylesheet is loaded in the app's CSS-in-JS string at startup. Card fonts are a curated subset; custom fonts can also be uploaded to Supabase Storage.

---

## 4. SheetJS (xlsx)

**Type:** Spreadsheet parsing library  
**Version:** 0.20.3 (pinned tarball from SheetJS CDN — the npm registry copy has known vulnerabilities)

```js
// Loaded on demand — not in the initial bundle
const loadXlsx = () => import("xlsx");
```

**Used for:**
- Importing guest lists from `.xlsx` and `.csv`
- Exporting calls, finance and delivery reports to `.xlsx`

---

## 5. JSZip

**Type:** ZIP file creation library  
**Version:** `^3.10.1` from npm

```js
const loadJsZip = () => import("jszip").then(m => m.default);
```

**Used for:** Bulk card image download — renders all cards and packages them into a ZIP file.

---

## 6. html5-qrcode

**Type:** QR code scanner library  
**Version:** `^2.3.8`

**Used in:** `src/PublicScanPage.jsx` and `src/ScanPanel.jsx` — camera-based QR code scanning for door check-in.

---

## 7. Leaflet.js

**Type:** Map library  
**Version:** `1.9.4`  
**Loading:** Dynamic CDN load in `PublicGuestPage.jsx` (only when map section is shown)

```js
// Loaded at runtime only on the guest microsite, only when venue lat/lng exist
const script = document.createElement("script");
script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
```

**Used for:**
- Interactive map showing the event venue
- Street/satellite toggle (Esri WorldImagery tiles)
- Google Maps directions button

---

## 8. Google Maps

**Type:** Navigation deeplink (not embedded)  
**Usage:** A link on the guest microsite opens Google Maps with directions to the venue

```js
const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
```

No API key required — this uses the Google Maps web URL, not the Maps JavaScript API.

---

## 9. Gemini API (Google)

**Type:** Large language model API  
**Used for:** Data cleaning chat feature (`src/CleanDataChat.jsx`)  
**Access:** Via `supabase/functions/_shared/dataClean.js` — never called directly from the browser

**Flow:**
- Dev: Vite plugin handles POST at `/ai-clean` → reads `GEMINI_API_KEY` from `.env.development.local`
- Prod: Edge Function `ai-clean` → reads Gemini key from Supabase Vault

---

## 10. Heroku

**Type:** PaaS hosting  
**Used for:** Production deployment of the React SPA

**Key files:**
- `Procfile`: `web: node server.js`
- `server.js`: dependency-free static file server
- Root `package.json`: `"heroku-postbuild": "cd studio && npm ci && npm run build"`

**Configuration variables (set in Heroku dashboard or CLI):**

```bash
heroku config:set VITE_SUPABASE_URL=...
heroku config:set VITE_SUPABASE_ANON_KEY=...
heroku config:set VITE_BASE_PATH=/
heroku config:set VITE_SITE_URL=https://your-app.herokuapp.com/
```

---

## 11. GitHub Actions

**Type:** CI/CD  
**Configuration:** `.github/workflows/ci.yml`

**Pipeline:**
1. Lint (`npm run lint`)
2. Unit tests (`npm test`)
3. Edge Function tests (`npm run test:functions`)
4. Build (`npm run build`)
5. Smoke-test `server.js`
6. Deploy to Heroku (on `main` branch only, after all checks pass)

---

## 12. Integration Dependency Map

```
Browser
  │
  ├── Supabase (Auth, DB, Storage, Realtime, Vault)
  │     └── pg_cron → run-schedules Edge Function → messaging-service.co.tz
  │
  ├── Google Fonts (UI typography)
  │
  └── [Public pages only]
        ├── Leaflet.js CDN (unpkg.com)
        └── Google Maps deeplink (no API key)
```

**Lazy-loaded (not in initial bundle):**
- `xlsx` (SheetJS) — import/export
- `jszip` — bulk ZIP download
- Leaflet.js — guest microsite map

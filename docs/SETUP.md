# Nikadi Studio — Setup Guide

**Last updated:** 2026-11-16

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22+ | Required for Edge Function tests |
| npm | 10+ | Included with Node.js |
| Supabase account | — | Free tier works for development |
| messaging-service.co.tz account | — | For SMS/WhatsApp |
| Gemini API key (optional) | — | Only for the "Clean data" chat feature |

---

## 1. Clone & Install

```bash
git clone https://github.com/<org>/v1-Nikadi-Studio.git
cd v1-Nikadi-Studio/studio
npm install
```

---

## 2. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note your **Project URL** and **anon public key** (Settings → API)
3. In Supabase Dashboard:
   - Authentication → Sign In / Providers → Email → **turn off "Allow new users to sign up"** (invite-only)

---

## 3. Run the Database Schema

In Supabase Dashboard → SQL Editor → New Query:

```sql
-- Paste the contents of studio/supabase-schema.sql and run
-- This creates all tables, RLS policies, functions, triggers, and grants
-- It is safe to re-run at any time
```

This single file is idempotent and covers the full schema including roles, settings, and scanner.

---

## 4. Create Storage Buckets

In Supabase Dashboard → Storage → New bucket:

| Bucket name | Public? | Purpose |
|------------|---------|---------|
| `templates` | No | Card background images |
| `wa-cards` | **Yes** | Per-guest card JPEGs (WhatsApp needs public URLs) |
| `fonts` | No | Uploaded custom card fonts |
| `event-pages` | **Yes** | Microsite images (hero, gallery, dress code) |

For each bucket, add a Storage policy under Policies:
- `wa-cards` and `event-pages`: Allow SELECT for `anon` role (public read)
- All buckets: Allow SELECT, INSERT, UPDATE, DELETE for `authenticated` role

---

## 5. Configure Environment Variables

```bash
# In studio/ directory:
cp .env.example .env.development.local   # if .env.example exists, otherwise create manually
```

Create `studio/.env.development.local` with:

```env
# Required
VITE_SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR...

# Required for SMS in dev (from messaging-service.co.tz)
VITE_SMS_BEARER_TOKEN=your_sms_bearer_token

# Optional — for WhatsApp in dev (falls back to SMS token if missing)
VITE_WA_BEARER_TOKEN=your_wa_bearer_token

# Optional — for the "Clean data" AI chat (no VITE_ prefix — stays server-side)
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.0-flash   # optional, has a default
```

**Important:** `.env.development.local` is git-ignored. Never commit secrets.

---

## 6. Invite the First User

In Supabase Dashboard → SQL Editor, insert your own email as a Super Admin:

```sql
INSERT INTO app_users (email, role, active, full_name)
VALUES ('you@example.com', 'superuser', TRUE, 'Your Name')
ON CONFLICT (email) DO UPDATE SET role = 'superuser', active = TRUE;
```

---

## 7. Start the Dev Server

```bash
cd v1-Nikadi-Studio/studio
npm run dev
# → http://localhost:5173
```

Go to `http://localhost:5173` → sign in with your Supabase-invited email.

---

## 8. Run Tests

```bash
# Unit tests for src/lib/
npm test

# Edge Function tests (requires Node 22+)
npm run test:functions

# Linting
npm run lint

# Production build check
npm run build
```

---

## 9. Deploy to Heroku

### 9.1 One-time Setup

```bash
# Install Heroku CLI
heroku login

# From the git root (v1-Nikadi-Studio/)
heroku create nikadi-studio-prod

# Set environment variables
heroku config:set VITE_SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
heroku config:set VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR...
heroku config:set VITE_BASE_PATH=/
heroku config:set VITE_SITE_URL=https://nikadi-studio-prod.herokuapp.com/
```

### 9.2 GitHub Actions CI/CD (Recommended)

The repo includes `.github/workflows/ci.yml`. Connect your Heroku app to your GitHub repository:

1. GitHub repo → Settings → Secrets → add `HEROKU_API_KEY`, `HEROKU_APP_NAME`, `HEROKU_EMAIL`
2. Push to `main` → CI runs → Heroku deploys automatically

### 9.3 Manual Deploy

```bash
git push heroku main
```

### 9.4 Heroku Process

- `heroku-postbuild` in the root `package.json` runs `cd studio && npm install && npm run build`
- `Procfile`: `web: node server.js`
- `server.js`: dependency-free static file server with gzip, cache headers, HTTPS redirect, SPA fallback, `/healthz`

---

## 10. Set Up Supabase Vault Secrets (Production)

For production messaging, the provider tokens must live in Supabase Vault (not in environment variables that could leak):

```sql
-- In Supabase SQL Editor
SELECT vault.create_secret('your_sms_token_here', 'nikadi_sms_token');
SELECT vault.create_secret('your_wa_token_here',  'nikadi_wa_token');
SELECT vault.create_secret('https://xxxxxxxxxxx.supabase.co', 'nikadi_project_url');
SELECT vault.create_secret('your_cron_secret_here', 'nikadi_cron_secret');
```

Then enable pg_cron and pg_net extensions:
- Supabase Dashboard → Database → Extensions → enable `pg_cron` and `pg_net`

The `run-schedules` Edge Function (for scheduled SMS/WA sends) is set up in `supabase-roles-settings-scan.sql` automatically once these secrets and extensions exist.

---

## 11. Set Up Supabase Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
cd v1-Nikadi-Studio
supabase login
supabase link --project-ref xxxxxxxxxxx

# Deploy all Edge Functions
supabase functions deploy send-sms
supabase functions deploy send-wa
supabase functions deploy run-schedules
supabase functions deploy ai-clean

# Set secrets for Edge Functions
supabase secrets set NIKADI_SMS_TOKEN=your_sms_token
supabase secrets set NIKADI_WA_TOKEN=your_wa_token
supabase secrets set GEMINI_API_KEY=your_gemini_key  # for ai-clean only
```

---

## 12. First Run Checklist

After completing setup, verify these work:

- [ ] Sign in with your invited email
- [ ] Create a test event
- [ ] Import a guest list from a sample CSV
- [ ] Export a card image from the Design tab
- [ ] Send a test SMS to your own phone number
- [ ] Open the Scanner tab and scan a QR code
- [ ] Enable guest links on the event and open one in an incognito tab
- [ ] Add a financial transaction and check the event P&L

---

## 13. Environment Notes

| Scenario | SMS/WA token | AI clean | Notes |
|----------|-------------|---------|-------|
| Dev (`npm run dev`) | `VITE_SMS_BEARER_TOKEN` from `.env.development.local` | `GEMINI_API_KEY` from `.env.development.local` | Vite proxies forward directly |
| Production | From Supabase Vault | From Supabase Vault | Edge Functions inject secrets server-side |
| Test (`npm test`) | Mocked | Not tested | Unit tests only; no network calls |

---

## Troubleshooting Setup

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Not connected to the database" | Missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` | Add to `.env.development.local` and restart `npm run dev` |
| Login page but can't sign in | Email not in `app_users` | Insert via SQL (Step 6) |
| SMS sends show "no token" error | Missing `VITE_SMS_BEARER_TOKEN` | Add to `.env.development.local` |
| Cards not uploading to WhatsApp | `wa-cards` bucket not public | Set bucket to public in Supabase Storage |
| Guest page returns "Link not found" | `guest_link_enabled` is false on event | Toggle in EventModal or the event was not found |
| Scheduled sends not firing | `pg_cron` / `pg_net` not enabled, or Vault secrets missing | Enable extensions + set secrets |

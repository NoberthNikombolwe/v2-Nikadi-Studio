# Nikadi Studio — Debugging Guide

**Last updated:** 2026-11-16

---

## 1. Quick Diagnostic Checklist

Before diving deeper, run through these first:

```bash
# Is the dev server running?
cd studio && npm run dev

# Does the build pass?
npm run build

# Any TypeScript/ESLint errors?
npm run lint

# Do unit tests pass?
npm test
```

Open the browser console (`F12 → Console`) and look for red errors. Most issues announce themselves there.

---

## 2. Authentication Issues

### 2.1 "Access denied" on sign-in

**Symptom:** Sign-in fails with "Access denied" or similar.

**Cause:** The email is not in `app_users` with `active = true`, or the trigger `trg_fn_check_app_user` fired.

**Fix:**
```sql
-- Check if the user exists and is active
SELECT email, role, active FROM app_users WHERE email = 'user@example.com';

-- If the row is missing, invite them from Settings → Users in the app
-- If active = false, an admin needs to re-enable them
UPDATE app_users SET active = TRUE WHERE email = 'user@example.com';
```

---

### 2.2 Stuck on the sign-in screen after a valid sign-in

**Symptom:** Credentials accepted, but the app never loads — stays on the sign-in screen.

**Cause:** Supabase `onAuthStateChange` fired but `app_users` lookup failed (network error, RLS issue, wrong role).

**Debug:**
1. Open DevTools → Network → look for a failed `app_users` request
2. Check the console for `[auth]` log messages
3. Try signing out and back in

```js
// In the browser console (dev only):
const { data } = await supabase.auth.getSession();
console.log(data.session?.user?.email);
```

---

### 2.3 Session expires mid-session

**Symptom:** Actions silently fail; console shows `JWT expired`.

**Cause:** Supabase refresh token cycle failed.

**Fix:** Supabase JS client handles refresh automatically. If it fails, the user needs to sign in again. Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct and that the Supabase project is not paused.

---

## 3. Data Not Loading

### 3.1 Events tab shows nothing / spinner forever

**Symptom:** Events tab is empty or never stops loading.

**Cause options:**
1. No events in the database yet (expected)
2. Supabase client not initialised (env vars missing)
3. RLS policy blocking the query
4. Network error

**Debug:**
```js
// In the browser console:
const { data, error } = await supabase.from("events").select("*").limit(5);
console.log({ data, error });
```

If `error` is non-null, the message will say why. Common errors:
- `relation "events" does not exist` → schema not applied
- `new row violates row-level security` → RLS config issue
- `TypeError: Cannot read properties of null` → `supabase` is null (env vars missing)

**Check env vars:**
```bash
# studio/.env
cat studio/.env
# Should have VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

---

### 3.2 Guest cards table is empty after import

**Symptom:** Import succeeds (green toast) but no cards appear.

**Cause options:**
1. Wrong event selected
2. Import skipped all rows (all duplicates)
3. The view is filtered

**Debug:**
```sql
-- How many cards does this event have?
SELECT COUNT(*) FROM event_cards WHERE event_id = '<your-event-id>';

-- Check the most recent 10 cards
SELECT name, card_type, created_at FROM event_cards
ORDER BY created_at DESC LIMIT 10;
```

---

### 3.3 `card_code` is NULL on new cards

**Symptom:** Cards imported after the schema update have no code badge.

**Cause:** The trigger `trg_event_cards_card_code` was not applied, or the schema section O was not run.

**Fix:**
```sql
-- Check if the trigger exists
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_event_cards_card_code';

-- If missing, re-run section O of supabase-schema.sql
-- Then backfill existing null codes:
UPDATE event_cards SET card_code = gen_card_code() WHERE card_code IS NULL;
```

---

## 4. Public Guest Page Issues

### 4.1 Guest link returns "Link not found"

**Symptom:** Opening `#/g/<eventId>/<guestId>` shows the "Link not found" state.

**Cause options:**
1. `guest_link_enabled = false` for the event
2. Wrong public IDs in the URL
3. `public_event_page_data` RPC does not exist yet

**Debug:**
```js
// In an incognito window's console:
const { data, error } = await supabase.rpc("public_event_page_data", {
  p_event_public_id: "ABC12345",  // 8-char event public ID
  p_guest_public_id: "XYZ67890"   // 8-char guest public ID
});
console.log({ data, error });
```

If `error` says the function does not exist:
```sql
-- Check the RPC exists
SELECT proname FROM pg_proc WHERE proname = 'public_event_page_data';
-- If missing, re-run section O of supabase-schema.sql
```

If `data` is null, check:
```sql
SELECT public_id, guest_link_enabled FROM events WHERE public_id = 'ABC12345';
SELECT public_id FROM event_cards WHERE public_id = 'XYZ67890';
```

---

### 4.2 Map does not appear

**Symptom:** Location section shows no map.

**Cause options:**
1. `venue_lat` / `venue_lng` not set for the event page
2. Leaflet CDN failed to load
3. Browser blocked `unpkg.com`

**Debug:**
1. Open DevTools → Network → search for `leaflet.js` → check if it loaded (200) or failed (blocked/timeout)
2. Check the console for `Leaflet is not defined`
3. Verify `venue_lat` and `venue_lng` are set via "Manage Page" → Location section

---

### 4.3 Card download button does nothing

**Symptom:** Download button appears but clicking it does not trigger a download.

**Cause:** `card_url` is null — the card was never exported and uploaded.

**Fix:** Go to the Design tab, export the card for this guest, which uploads it and sets `card_url`. The public page reads `card_url` from the RPC response.

---

### 4.4 OG thumbnail not showing in WhatsApp preview

**Symptom:** WhatsApp shows a plain link instead of a card thumbnail.

**Cause options:**
1. `og:image` URL is not publicly accessible
2. The image URL requires authentication (private bucket)
3. WhatsApp cached a previous version of the page

**Fix:**
1. The `card_url` must be in the `wa-cards` bucket (public) or `event-pages` bucket (public)
2. Open the image URL directly in an incognito browser tab — it must load without signing in
3. WhatsApp refreshes OG data after a cache expiry (~24 hours) — test with a new link

---

## 5. SMS / WhatsApp Delivery Issues

### 5.1 SMS send fails silently

**Symptom:** Send button clicked, no toast or the toast says "sent" but no SMS received.

**Debug:**
1. Check DevTools → Network → `/sms-proxy/api/sms/v2/send` (dev) or `/functions/v1/send-sms` (prod)
2. Look at the response body — provider errors appear there
3. Check `event_logs` in the database:
```sql
SELECT action, detail, created_at FROM event_logs
WHERE action LIKE '%sms%'
ORDER BY created_at DESC LIMIT 20;
```

**Common provider errors:**
| Error | Meaning |
|-------|---------|
| `401 Unauthorized` | Bearer token invalid or expired |
| `400 Bad Request` | Phone number format wrong |
| `429 Too Many Requests` | Rate limit hit |

---

### 5.2 SMS delivery status stuck on "sent"

**Symptom:** Delivery status never updates from "sent" to "delivered".

**Cause options:**
1. `run-schedules` Edge Function is not running (pg_cron not set up)
2. The provider's delivery report endpoint returned an error
3. The phone number was invalid and the provider dropped it silently

**Debug:**
```sql
-- Check if pg_cron is polling
SELECT * FROM cron.job WHERE jobname = 'run-schedules';

-- Check the most recent delivery records
SELECT * FROM message_deliveries ORDER BY created_at DESC LIMIT 10;
```

---

### 5.3 WhatsApp card image not sent

**Symptom:** WhatsApp message sent but recipient receives no image.

**Cause:** `card_url` is null or the image URL is not publicly accessible.

**Fix:**
1. Export and upload the card in the Design tab
2. Verify the `card_url` column is set for the guest:
```sql
SELECT name, card_url FROM event_cards WHERE id = '<card-id>';
```

---

## 6. Supabase Edge Function Issues

### 6.1 Edge Function returns 500

**Symptom:** A Supabase Edge Function call fails with HTTP 500.

**Debug:**
```bash
# View function logs (requires supabase CLI linked)
supabase functions logs send-sms --tail

# Or in the Supabase Dashboard:
# Functions → send-sms → Logs
```

Common causes:
- Vault secret missing or misnamed
- Provider endpoint unreachable
- Supabase project paused (free tier)

---

### 6.2 Vault secret not found

**Symptom:** Edge Function log says `vault secret not found` or `null` provider token.

**Fix:**
```sql
-- List existing secrets (names only, not values)
SELECT name FROM vault.secrets;

-- Create the missing secret
SELECT vault.create_secret('your_sms_token', 'nikadi_sms_token');
SELECT vault.create_secret('your_wa_token',  'nikadi_wa_token');
```

---

### 6.3 pg_cron job not firing

**Symptom:** Scheduled messages never send in production.

**Debug:**
```sql
-- Check if the cron job is registered
SELECT * FROM cron.job;

-- Check recent cron execution history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Check for failures
SELECT * FROM cron.job_run_details WHERE status = 'failed' ORDER BY start_time DESC;
```

If the job is missing, re-run the cron registration SQL from `supabase-schema.sql`.

---

## 7. Build Failures

### 7.1 Vite build fails

```bash
cd studio && npm run build
```

**Common causes and fixes:**

| Error | Fix |
|-------|-----|
| `Cannot find module 'X'` | Run `npm install` |
| `Unexpected token` | Syntax error in `App.jsx` or another file — check the line number |
| `Environment variable VITE_X not defined` | Add it to `.env` |
| `Circular dependency` | Check imports — `App.jsx` imports are mostly flat |

---

### 7.2 `npm install` fails

```bash
# Clear the cache and try again
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

If SheetJS (`xlsx`) fails to install (the pinned tarball):
```bash
# Check the tarball URL in package.json
# It must be the SheetJS CDN URL, not the npm registry version
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

---

## 8. UI / React Issues

### 8.1 Modal does not close

**Symptom:** Clicking ✕ or Cancel does nothing.

**Cause:** The `onClose` prop is not wired, or the state setter is not being called.

**Debug:**
```js
// Add a console.log to the close handler temporarily
<button onClick={() => { console.log("closing"); onClose(); }}>✕</button>
```

Note: Modals intentionally do not close on backdrop click or Esc. Only the ✕ button and Cancel button close them.

---

### 8.2 State not updating after save

**Symptom:** A save operation completes (green toast) but the UI does not reflect the new data.

**Cause:** The local state was not refreshed after the Supabase write.

**Pattern to follow:**
```js
const saveRecord = async () => {
  const { error } = await supabase.from("events").upsert(data);
  if (error) { showToast(error.message, "warn"); return; }
  showToast("Saved");
  await loadSavedEvents();  // <-- reload the state from Supabase
};
```

---

### 8.3 Toggle does not work / crashes

**Symptom:** A `<Toggle>` component shows but clicking it does nothing or throws.

**Cause:** The `Toggle` component is defined at `App.jsx:3113`. Code above that line cannot use it. If a component before that line tries to render `<Toggle>`, React will throw `Toggle is not defined`.

**Fix:** Move the toggle usage to a component defined after line 3113, or use a plain `<input type="checkbox">` for components near the top of the file.

---

### 8.4 Icon shows as blank / broken

**Symptom:** An `<Icon>` renders nothing or a broken square.

**Cause:** The icon name passed to `<Icon n="..." />` is not in the `P` map in `src/Icon.jsx`.

**Fix:**
```js
// Check what icons are available in Icon.jsx
// The P map looks like:
// const P = { trash: "...", save: "...", palette: "...", ... }
// Find the right key or add a new entry
```

---

## 9. Database / Schema Issues

### 9.1 Table or column does not exist

**Symptom:** Queries fail with `column "X" does not exist` or `relation "Y" does not exist`.

**Cause:** The schema was not fully applied, or a new migration in `supabase-schema.sql` was not run.

**Fix:**
1. The schema file is designed to be run in full — it is idempotent (uses `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`)
2. Run the entire file against the database:
```bash
# Via Supabase CLI
supabase db reset  # WARNING: drops all data in local dev
# OR apply just the new section via the SQL Editor in Supabase Dashboard
```

3. For production, apply only the new SQL sections via the Supabase Dashboard SQL Editor.

---

### 9.2 RLS policy is blocking a legitimate query

**Symptom:** A query returns empty results or `permission denied` even when signed in.

**Debug:**
```sql
-- Check what policies exist on a table
SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'event_pages';

-- Test as the authenticated role
SET LOCAL role = authenticated;
SELECT * FROM event_pages LIMIT 5;
RESET role;
```

---

## 10. Storage Issues

### 10.1 Image upload fails

**Symptom:** Uploading a card template or event page image fails with a storage error.

**Cause options:**
1. Bucket does not exist
2. Bucket policy blocks authenticated uploads
3. File size exceeds the bucket limit (default 50MB per file on most plans)

**Debug:**
```bash
# Check buckets in Supabase Dashboard → Storage
# Or via API:
const { data, error } = await supabase.storage.listBuckets();
console.log({ data, error });
```

**Required buckets and their visibility:**

| Bucket | Public? | Purpose |
|--------|---------|---------|
| `templates` | No | Card background images |
| `fonts` | No | Custom card fonts |
| `wa-cards` | Yes | Exported card images for WhatsApp |
| `event-pages` | Yes | Hero images, gallery, dress code for microsites |

The `event-pages` bucket must be created manually in the Supabase Dashboard. Set it to public.

---

### 10.2 Card image URL returns 403

**Symptom:** `card_url` is set but the image does not load on the guest page.

**Cause:** The `wa-cards` bucket is set to private, or the URL is a signed URL that expired.

**Fix:** In Supabase Dashboard → Storage → `wa-cards` → bucket settings → set to Public.

---

## 11. Development Environment Issues

### 11.1 Vite proxy not working

**Symptom:** SMS/WhatsApp sends in development get `CORS` or `network error`.

**Cause:** The Vite dev proxy is not configured, or is using the wrong path prefix.

**Check:** `studio/vite.config.js` should have:
```js
server: {
  proxy: {
    '/sms-proxy': { target: 'https://messaging-service.co.tz', changeOrigin: true, rewrite: p => p.replace(/^\/sms-proxy/, '') },
    '/wa-proxy':  { target: 'https://messaging-service.co.tz', changeOrigin: true, rewrite: p => p.replace(/^\/wa-proxy/, '') },
  }
}
```

---

### 11.2 `VITE_SUPABASE_URL` is undefined at runtime

**Symptom:** Console shows `supabase is null` or `Cannot read properties of null`.

**Cause:** The `.env` file is missing or not loaded.

**Fix:**
```bash
# studio/.env must exist with:
VITE_SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

# After editing .env, restart the dev server
npm run dev
```

---

## 12. Production (Heroku) Issues

### 12.1 Deploy fails at build step

**Symptom:** Heroku deploy log shows `npm run build` failing.

**Common causes:**

| Issue | Fix |
|-------|-----|
| Missing `VITE_*` config vars | Set them: `heroku config:set VITE_SUPABASE_URL=...` |
| Node version mismatch | Add `"engines": {"node": "22.x"}` to root `package.json` |
| Out-of-memory during build | Add `heroku config:set NODE_OPTIONS=--max_old_space_size=512` |

---

### 12.2 App loads but Supabase calls fail in production

**Symptom:** Dev works, production does not. Console shows `401` or CORS errors.

**Cause:** Supabase project has `anon` key blocked from your Heroku URL, or the config vars point to a different project.

**Check:**
```bash
heroku config | grep VITE
# Verify the URL and key match the production Supabase project
```

---

## 13. Getting More Information

### Browser DevTools

- **Console:** JavaScript errors and `console.log` output
- **Network:** All Supabase and provider HTTP calls — click a request to see the full request/response
- **Application → Local Storage:** Check `sb-*` keys for the Supabase session

### Supabase Dashboard

- **Table Editor:** Browse rows directly
- **SQL Editor:** Run diagnostic queries
- **Storage:** Check buckets and files
- **Functions → Logs:** Edge Function execution logs
- **Auth → Users:** See all signed-in users

### Useful SQL Queries

```sql
-- Last 20 audit log entries
SELECT user_email, action, detail, created_at
FROM event_logs ORDER BY created_at DESC LIMIT 20;

-- Cards with no code (should be 0 after schema migration)
SELECT COUNT(*) FROM event_cards WHERE card_code IS NULL;

-- Events with guest links enabled
SELECT username, public_id, guest_link_enabled FROM events
WHERE guest_link_enabled = TRUE;

-- Check all RLS policies
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

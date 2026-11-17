# Nikadi Studio — API Reference

**Last updated:** 2026-11-16

---

## 1. Overview

The app consumes three API surfaces:

| Surface | Base URL | Auth |
|---------|----------|------|
| Supabase REST API | `VITE_SUPABASE_URL/rest/v1/` | Supabase JWT (Bearer) |
| Supabase RPCs | `VITE_SUPABASE_URL/rest/v1/rpc/` | Supabase JWT (Bearer) |
| SMS/WA Provider (dev) | Vite proxy `/sms-proxy`, `/wa-proxy` | Provider Bearer token |
| SMS/WA Provider (prod) | Supabase Edge Functions | Supabase JWT → Edge Function injects provider token |
| AI Clean (dev) | Vite plugin `/ai-clean` | None (dev only) |
| AI Clean (prod) | Supabase Edge Function `ai-clean` | Supabase JWT |

---

## 2. Supabase Client Usage

```js
import { supabase } from "./lib/supabase";

// Guard before every call
if (!supabase) { showToast("Not connected", "warn"); return; }

// Select
const { data, error } = await supabase
  .from("events")
  .select("id,username,event_type,status,start_datetime")
  .order("created_at", { ascending: false });

// Insert
const { data: row, error } = await supabase
  .from("events")
  .insert({ username: "Harusi ya Ali", event_type: "harusi" })
  .select("id")
  .single();

// Update
const { error } = await supabase
  .from("events")
  .update({ status: "completed" })
  .eq("id", eventId);

// Delete (Super Admin only in UI)
const { error } = await supabase
  .from("events")
  .delete()
  .eq("id", eventId);

// RPC
const { data, error } = await supabase.rpc("function_name", { param: value });
```

---

## 3. Public SECURITY DEFINER RPCs

These are callable by the `anon` role (no login). They expose the minimum needed.

### 3.1 `public_event_page_data`

Returns all data needed to render a guest's invitation microsite.

```sql
public_event_page_data(
  p_event_public_id TEXT,       -- required
  p_guest_public_id TEXT DEFAULT NULL  -- optional (omit for event-only page)
) RETURNS JSONB
```

**Returns:** JSON object or NULL (if event not found / guest_link_enabled = false)

```json
{
  "event_name": "Harusi ya Ali na Fatuma",
  "event_type": "harusi",
  "start_datetime": "2027-03-15T10:00:00+03:00",
  "end_datetime": "2027-03-15T22:00:00+03:00",
  "venue_name": "Mwalimu Nyerere Hall",
  "venue_address": "Dar es Salaam",
  "page_settings": {
    "primary_color": "#00C2FF",
    "accent_color": "#7C3AED",
    "bg_color": "#0A0F1E",
    "text_color": "#FFFFFF",
    "hero_image_url": "https://...",
    "tagline": "Tunaalikuwa kwa furaha",
    "hosts": [{ "name": "Ali", "role": "Bwana Harusi", "photo_url": null }],
    "schedule": [{ "time": "10:00", "title": "Mapokezi", "description": "" }],
    "dress_code_text": "Mavazi ya rangi ya samawati",
    "dress_code_image_url": null,
    "gallery": ["https://...", "https://..."],
    "rsvp_enabled": true,
    "rsvp_message": "Tafadhali tuthibitishie…",
    "venue_lat": -6.7924,
    "venue_lng": 39.2083,
    "venue_description": "Ndani ya JCC, mlango wa pili",
    "show_countdown": true
  },
  "guest_name": "Juma Hassan",
  "card_type": "DOUBLE",
  "card_url": "https://...supabase.co/storage/.../card.jpg",
  "card_code": "7B42"
}
```

**Client usage:**
```js
const { data, error } = await supabase.rpc("public_event_page_data", {
  p_event_public_id: "ABC12345",
  p_guest_public_id: "XYZ67890",
});
```

### 3.2 `public_guest_card` (legacy)

Simpler RPC returning a table row. Kept for backward compatibility.

```sql
public_guest_card(
  p_event_public_id TEXT,
  p_guest_public_id TEXT
) RETURNS TABLE (event_name, event_type, start_datetime, venue_name, guest_name, card_type, card_url)
```

Returns no rows if `guest_link_enabled = FALSE` on the event.

### 3.3 `submit_rsvp`

Write path for RSVP submissions (anon-callable).

```sql
submit_rsvp(
  p_event_public_id TEXT,
  p_guest_public_id TEXT,
  p_attending       BOOLEAN,
  p_message         TEXT DEFAULT NULL
) RETURNS JSONB
```

Returns `{"ok": true}` on success, `{"ok": false, "error": "..."}` on failure.

**Client usage:**
```js
const { data: res } = await supabase.rpc("submit_rsvp", {
  p_event_public_id: eventPublicId,
  p_guest_public_id: guestPublicId,
  p_attending: true,
  p_message: "Hongera sana!",
});
if (res?.ok) { /* success */ }
```

### 3.4 Scanner RPCs

| RPC | Purpose |
|-----|---------|
| `public_scan_event(scan_code)` | Get event details for the scanner page |
| `public_find_cards(event_id, q)` | Search guests by name/code |
| `scan_card(event_id, card_id, scan_code, reason)` | Atomic door check-in |
| `public_recent_scans(event_id, scan_code)` | Last N scan log entries |
| `public_scan_stats(event_id, scan_code)` | Aggregate stats |

### 3.5 View-Only Share RPCs

| RPC | Purpose |
|-----|---------|
| `public_view_event(view_code)` | Event data for the view-only page |
| `public_view_cards(event_id, view_code)` | Guest list for the view-only report |

---

## 4. Messaging Provider API

Provider: **messaging-service.co.tz**

### 4.1 SMS — Single Send

```
POST /api/sms/v2/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "from": "NIKADI",
  "to": "255712345678",
  "text": "Habari Juma, kadi yako iko tayari!"
}
```

### 4.2 SMS — Bulk Send

```
POST /api/sms/v2/bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "from": "NIKADI",
  "messages": [
    { "to": "255712345678", "text": "Habari Juma…" },
    { "to": "255787654321", "text": "Habari Fatuma…" }
  ]
}
```

Response includes `groupId` per batch, used for delivery report polling.

### 4.3 Delivery Reports

```
GET /api/sms/v2/delivery/{groupId}
Authorization: Bearer <token>
```

### 4.4 WhatsApp — Send with Media

```
POST /api/wa/v2/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "to": "255712345678",
  "type": "image",
  "image": { "url": "https://...public-card-url.jpg" },
  "caption": "Habari Juma, mwaliko wako uko hapo!"
}
```

### 4.5 In-App Proxy

**Dev:** Vite proxies `/sms-proxy` → `https://messaging-service.co.tz` and `/wa-proxy` → same.

**Prod:** Supabase Edge Functions `send-sms` and `send-wa` are thin proxies that:
1. Verify the caller has a valid Supabase session
2. Allowlist specific provider endpoints
3. Inject the provider Bearer token from Supabase Vault
4. Forward the request

The browser only ever sends the user's Supabase JWT — the provider token never leaves the server.

---

## 5. Edge Function: `run-schedules`

Called by `pg_cron` every minute (and separately for delivery checks). Accepts:

```
POST /functions/v1/run-schedules
Authorization: Bearer <supabase-anon-key>
x-cron-secret: <HMAC secret from Vault>
Content-Type: application/json

{ "task": "sends" }      // process due scheduled sends
{ "task": "deliveries" } // poll delivery reports
```

---

## 6. Edge Function: `ai-clean`

Proxies to Gemini API for the data cleaning chat feature.

```
POST /functions/v1/ai-clean
Authorization: Bearer <user-supabase-jwt>
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Clean this list: Juma Hassan,0712345678,DOUBLE\n..." }
  ]
}
```

**Dev:** Handled by the Vite plugin at `/ai-clean` (uses `GEMINI_API_KEY` from `.env.development.local`).

---

## 7. Storage API

```js
// Upload a card image to wa-cards bucket
const { error } = await supabase.storage
  .from("wa-cards")
  .upload(path, blob, { contentType: "image/jpeg", upsert: true });

// Get public URL
const { data: { publicUrl } } = supabase.storage
  .from("wa-cards")
  .getPublicUrl(path);

// Upload event page image
const { error } = await supabase.storage
  .from("event-pages")
  .upload(`${eventId}/hero_${Date.now()}.jpg`, file, { contentType: file.type, upsert: true });

// Remove files
const { error } = await supabase.storage
  .from("wa-cards")
  .remove(["path/to/file.jpg"]);
```

---

## 8. Real-time Subscriptions

```js
// Subscribe to scanner events
const channel = supabase
  .channel(`scan_logs:${eventId}`)
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "scan_logs",
    filter: `event_id=eq.${eventId}`,
  }, (payload) => { /* handle new scan */ })
  .subscribe();

// Unsubscribe on cleanup
supabase.removeChannel(channel);
```

Realtime is enabled on: `event_cards`, `scan_logs`, `message_deliveries`.

---

## 9. Error Handling Conventions

```js
// Always guard supabase
if (!supabase) { showToast("Not connected to the database", "warn"); return; }

// Always check error
const { data, error } = await supabase.from("events").select("*");
if (error) { showToast(`Could not load events: ${error.message}`, "warn"); return; }

// RPC errors — provider errors come through as the RPC's return value
const { data: res, error: rpcErr } = await supabase.rpc("submit_rsvp", {...});
if (rpcErr || !res?.ok) { /* handle */ }
```

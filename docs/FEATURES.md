# Nikadi Studio — Feature Development Guide

**Last updated:** 2026-11-16

---

## Implemented Features

### F-01: Event Management

**Location:** Events tab (`tab === "events"`)  
**Key components:** `EventModal`, `EventOverview`, `savedEvents` state

**What it does:**
- Create, edit, archive events
- Each event: name, type, venue, dates, customer link, region, package price
- Guest invitation link toggle (opt-in public microsite)
- Card footer settings (branding pill per event)

**Key state:**
```js
savedEvents          // array of all events from Supabase
openEventRow         // the currently loaded event object
savedEventId         // UUID of the loaded event
```

**Data flow:**
```
loadSavedEvents() → Supabase events SELECT → savedEvents[]
selectEvent(ev)  → load event_cards for ev → records[]
persistEvent()   → Supabase events UPSERT → reload
```

---

### F-02: CRM Pipeline

**Location:** Leads + Customers tabs  
**Key components:** `LeadsTab`, `CustomersTab`, `LeadModal`, `CustomerModal`, `useCrm()`

**Pipeline:**
```
Lead (new) → Follow-up logged → Lead (contacted) → Qualified → Customer + Event created
                                                 → Lost
```

**Data flow:**
```
useCrm()
  ├── loadLeads()       → leads + lead_followups SELECT
  ├── loadCustomers()   → customers SELECT
  ├── loadEventCounts() → events grouped by customer_id
  ├── saveLead()        → leads UPSERT
  ├── addFollowup()     → lead_followups INSERT
  └── qualifyLead()     → creates customer + event, updates lead
```

---

### F-03: Card Designer

**Location:** Design tab  
**Key components:** `<CardCanvas>`, `exportCard()`

**How it works:**
- Background image (from `events.cover_image_url` or `saved_templates`)
- Draggable elements: `name`, `cardtype`, `date`, `qr`, `logo`, `footer`
- Each element has: position (x/y as 0-1 share of canvas), size, colour, font, bold/italic
- `exportCard(record, elements, settings, event, [imageUrl])` renders to canvas → returns JPEG data URL

**Card footer:**
- Always rendered on every card unless `hidden: true` in `events.card_footer`
- Position snaps to bottom-centre; draggable anywhere
- Text: branding name + phone from Settings or per-event override

---

### F-04: Guest Import

**Location:** Contacts tab → Import button  
**Key function:** `GuestImport` component, `guestMerge.js`

**Import logic (guestMerge):**
```
Spreadsheet rows → normaliseSheetRows() → candidate list
                                        → planCardSave(): classify each row as:
                                          - keep (unchanged)
                                          - update (name/phone match, card type differs)
                                          - add (new guest)
                                          - duplicate (skip)
```

**Merge rules:**
- Exact `name + phone + card_type` → skip (duplicate)
- Matching `name + phone` → update card type
- New → insert
- A new import resets send statuses (`status_reset_at`)

---

### F-05: WhatsApp Distribution

**Location:** WhatsApp tab (`tab === "whatsapp"`)

**Send flow:**
1. Staff selects recipients (all / by status)
2. Card images rendered via `exportCard()`
3. Each card uploaded to `wa-cards` bucket → public URL obtained
4. `POST /wa-proxy/api/wa/v2/send` with image URL + caption
5. `wa_status` updated to `sent` on success

**Delivery tracking:**
- Provider returns a delivery ID per message
- `message_deliveries` row inserted per send
- `pg_cron` polls delivery reports, updates `message_deliveries`
- App subscribes to Realtime on `message_deliveries` to show live status

---

### F-06: SMS Distribution

**Location:** SMS tab (`tab === "sms"`)  
**Key function:** `buildSmsMsg(rec)`, `sendSmsMessages()`

**Features:**
- Main SMS message per event (plain template)
- Multiple extra messages per event (`events.sms_messages` JSONB array)
- `{name}`, `{cardType}`, `{anyColumn}` placeholders
- Guest invitation link appended automatically if `guest_link_enabled`

**Scheduled SMS:**
- Create a schedule → stored in `message_schedules`
- `pg_cron` calls `run-schedules` Edge Function every minute
- Edge Function processes due schedules, sends via messaging-service.co.tz

---

### F-07: Guest Invitation Microsites

**Location:** `src/PublicGuestPage.jsx`  
**URL pattern:** `#/g/<eventPublicId>/<guestPublicId>`

**Features:**
- OG meta tags for WhatsApp/SMS link thumbnails
- Full-screen hero image + countdown timer (days/hours/mins/secs)
- Guest card section: name, card type badge, 4-char code badge, card download
- Schedule / Ratiba timeline
- Dress code (text + image)
- Photo gallery grid
- Hosts/MC list
- RSVP form → `submit_rsvp()` RPC
- Leaflet.js map (CDN) with street/satellite toggle + Google Maps directions

**Admin management:**
- "Manage Page" button in Events tab → `EventPageModal`
- Sections: Appearance (colours, hero, tagline), Hosts, Ratiba, Dress Code, Gallery, RSVP, Location
- Images uploaded to `event-pages` Supabase Storage bucket

**Data flow:**
```
PublicGuestPage loads
  → supabase.rpc("public_event_page_data", { p_event_public_id, p_guest_public_id })
  → renders microsite with page_settings + guest data
```

---

### F-08: Door Scanner

**Location:** `src/PublicScanPage.jsx` (public) + Scanner tab (admin)  
**URL pattern:** `#/scan/<eventId>` (requires `scan_code` stored in URL or entered)

**How it works:**
1. Guest presents QR code (encodes `event_id + card_id + salt`)
2. Scanner decodes QR → calls `scan_card()` RPC
3. RPC validates code, checks `max_scans`, inserts `scan_logs` row
4. Real-time feed shows latest scans across all scanner devices

**Admin scanner tab:**
- Shows live scan stats: admitted, rejected, by card type
- Can manually search and check in a guest
- Generates/regenerates the scan code

---

### F-09: Guest Call Tracker

**Location:** Calls tab (`tab === "calls"`)  
**Key state:** `call_status`, `call_comment`, `call_updated_at`, `call_by` on `event_cards`

**Call statuses:** `yes` (coming) / `no` (not coming) / `busy` (busy/no answer) / `picked` (picked up, no answer yet)

**Features:**
- Record answer per guest
- Comment field per guest
- Filter by answer status
- Stats: coming count + people count (from card type rules)
- Export to Excel
- Copy guest invitation link per guest

---

### F-10: Finance

**Location:** Finance tab (`tab === "finance"`)

**Features:**
- Finance accounts (bank, mobile money, cash)
- Income and expense transactions per event
- Event P&L: total income - total expenses = gross margin
- Category breakdown
- Export to Excel
- Super Admin can delete transactions

---

### F-11: 4-Character Card Codes

**Implemented in:** SQL trigger `trg_event_cards_card_code`, `gen_card_code()` function  
**Visible in:** Calls tab (card code badge), PublicGuestPage (code badge on card section)

**Format:** 3 digits + 1 letter (from unambiguous set A-Z except I, O, L), random position  
**Examples:** `7B42`, `A395`, `9K01`, `23H7`

---

## Feature Flags

| Flag | Column | Default | Effect when TRUE |
|------|--------|---------|-----------------|
| Guest links | `events.guest_link_enabled` | FALSE | Shows Guest Links + Manage Page buttons; appends link to SMS; allows public RPC |

---

## Upcoming / Planned Features

| ID | Feature | Status |
|----|---------|--------|
| F-12 | RSVP dashboard for admins (see who is attending) | Planned |
| F-13 | Multiple invitation pages per event (English + Swahili) | Planned |
| F-14 | WhatsApp scheduled sends (similar to SMS schedules) | Planned |
| F-15 | Bulk delete of old events by admin | Planned |
| F-16 | Customer self-service proof approval | Planned |

---

## How to Add a New Feature

### Step 1: SQL Changes

Add to `studio/supabase-schema.sql`:
```sql
-- New column
ALTER TABLE events ADD COLUMN IF NOT EXISTS new_field TEXT;

-- New table
CREATE TABLE IF NOT EXISTS new_table (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  ...
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_new_table" ON new_table FOR ALL USING (auth.role() = 'authenticated');
REVOKE ALL ON TABLE new_table FROM anon;
GRANT ALL ON TABLE new_table TO authenticated;
```

### Step 2: App State

If the feature needs new state, add it near related state in `<App>`:
```js
const [newFeatureData, setNewFeatureData] = useState(null);
```

### Step 3: Data Loading

Add a load function following the existing pattern:
```js
const loadNewFeature = async () => {
  if (!supabase || !savedEventId) return;
  const { data, error } = await supabase
    .from("new_table")
    .select("*")
    .eq("event_id", savedEventId);
  if (error) { showToast(error.message, "warn"); return; }
  setNewFeatureData(data);
};
```

### Step 4: UI Component

Add a new function component in the appropriate section of `App.jsx`:
```js
function NewFeatureTab({ data, onSave, showToast, canEdit, canDelete }) {
  // ...
}
```

### Step 5: Tab Entry

```js
{tab === "newfeature" && (
  <NewFeatureTab
    data={newFeatureData}
    onSave={saveNewFeature}
    showToast={showToast}
    canEdit={canEdit}
    canDelete={canDelete}
  />
)}
```

### Step 6: Permissions

Add to `DEFAULT_MATRIX` in `src/lib/permissions.js` and in the SQL seed in `supabase-roles-settings-scan.sql`.

### Step 7: Tests

Add unit tests for any pure logic added to `src/lib/` in `src/lib/lib.test.js`.

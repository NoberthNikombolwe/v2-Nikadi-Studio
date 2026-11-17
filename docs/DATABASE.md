# Nikadi Studio — Database Reference

**Last updated:** 2026-11-16  
**Engine:** Supabase (Postgres 15+)  
**Schema files:** `studio/supabase-schema.sql`, `studio/supabase-roles-settings-scan.sql`

---

## 1. Schema Overview

```
┌─────────────────────────────────────────────────┐
│  CRM                                            │
│  leads → lead_followups                         │
│  customers ──┐                                  │
└──────────────┼──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│  EVENTS                                         │
│  events ──────────── event_cards                │
│      │                   │                      │
│      │               scan_logs                  │
│      │               message_deliveries         │
│      │               event_transactions         │
│      │               event_logs                 │
│      │               event_pages                │
│      └───────────────event_rsvps                │
└─────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│  SCHEDULES                                      │
│  message_schedules                              │
│  message_schedule_runs                          │
│  message_run_targets                            │
└─────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│  RBAC & SETTINGS                                │
│  app_users, app_roles, app_modules              │
│  role_permissions                               │
│  app_settings, wa_templates, sender_ids         │
│  card_type_rules                                │
│  finance_accounts, saved_templates              │
│  app_feedback                                   │
└─────────────────────────────────────────────────┘
```

---

## 2. Table Reference

### 2.1 `events`

One row per event/batch managed by the studio.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `username` | TEXT NOT NULL | Event name / client name |
| `phone` | TEXT | Contact phone |
| `event_type` | TEXT | harusi, birthday, graduation, etc. |
| `status` | TEXT | `active` / `completed` / `cancelled` |
| `venue_name` | TEXT | |
| `venue_address` | TEXT | |
| `venue_location` | TEXT | City or GPS coordinates |
| `start_datetime` | TIMESTAMPTZ | |
| `end_datetime` | TIMESTAMPTZ | |
| `cover_image_url` | TEXT | Background template image URL |
| `elements_layout` | JSONB | Draggable card element positions/styles |
| `sms_message` | TEXT | Main SMS template |
| `sms_draft` | TEXT | Auto-saved SMS working copy |
| `sms_messages` | JSONB | Extra SMS messages array |
| `customer_id` | UUID → `customers` | |
| `lead_id` | UUID → `leads` | |
| `package_price` | NUMERIC(12,2) | TZS |
| `region` | TEXT | Tanzania region |
| `public_id` | TEXT UNIQUE | 8-char public ID (A–Z2–9, no 0/O/I/1/L) |
| `guest_link_enabled` | BOOLEAN DEFAULT FALSE | Opt-in for guest invitation links |
| `card_footer` | JSONB | Footer pill settings per event |
| `view_code` | TEXT | Code for the view-only share link |
| `scan_code` | TEXT | Code for the public scanner page |
| `created_at` | TIMESTAMPTZ | |

### 2.2 `event_cards`

One row per guest/contact in an event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `event_id` | UUID → `events` CASCADE | |
| `name` | TEXT | Guest name |
| `card_type` | TEXT | e.g. SINGLE, DOUBLE, VIP |
| `phone` | TEXT | |
| `wa_status` | TEXT | `idle` / `sending` / `sent` / `delivered` / `read` / `notSent` / `invalid` |
| `sms_status` | TEXT | `pending` / `sent` / `delivered` / `failed` |
| `card_url` | TEXT | Uploaded card image URL (wa-cards bucket) |
| `max_scans` | INT | From `card_type_rules` |
| `scan_count` | INT | Total door check-ins |
| `last_scanned_at` | TIMESTAMPTZ | |
| `call_status` | TEXT | `yes` / `no` / `busy` / `picked` / NULL |
| `call_comment` | TEXT | |
| `call_updated_at` | TIMESTAMPTZ | |
| `call_by` | TEXT | Email of staff who last updated |
| `status_reset_at` | TIMESTAMPTZ | When a new guest list reset send statuses |
| `public_id` | TEXT UNIQUE | 8-char public ID |
| `card_code` | TEXT | 4-char display code (3 digits + 1 letter) |
| `sent_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |

### 2.3 `event_logs`

Append-only audit log. No UPDATE or DELETE allowed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `event_id` | UUID → `events` | |
| `created_at` | TIMESTAMPTZ | `clock_timestamp()` per row |
| `user_email` | TEXT | Filled from `auth.jwt() ->> 'email'` |
| `channel` | TEXT | `whatsapp` / `sms` / `card` / `event` |
| `action` | TEXT | `send` / `status` / `upload` / `bulk` / `create` / `update` / `contacts` |
| `status` | TEXT | `sent` / `delivered` / `failed` / `ok` / etc. |
| `recipient_name` | TEXT | |
| `recipient_phone` | TEXT | |
| `message_title` | TEXT | SMS message title or WA template |
| `detail` | TEXT | Free-form notes |

### 2.4 `customers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | |
| `phone` | TEXT | Normalised (+255...) |
| `region` | TEXT | |
| `notes` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `created_by` | TEXT | Email from JWT |

### 2.5 `leads`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | |
| `phone` | TEXT | |
| `event_type` | TEXT | |
| `event_date` | DATE | |
| `package_price` | NUMERIC(12,2) | TZS |
| `region` | TEXT | |
| `venue` | TEXT | |
| `description` | TEXT | |
| `status` | TEXT | `new` / `contacted` / `qualified` / `lost` |
| `next_followup_date` | DATE | From latest follow-up |
| `customer_id` | UUID → `customers` | Set when qualified |
| `event_id` | UUID → `events` | Set when qualified |
| `qualified_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |
| `created_by` | TEXT | |

### 2.6 `event_transactions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `event_id` | UUID → `events` CASCADE | |
| `kind` | TEXT | `income` / `expense` |
| `amount` | NUMERIC(14,2) | Must be > 0 |
| `txn_date` | DATE | |
| `account_id` | UUID → `finance_accounts` | |
| `party` | TEXT | Who paid / was paid |
| `category` | TEXT | |
| `reference` | TEXT | Bank/mobile-money ref |
| `note` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `created_by` | TEXT | |

### 2.7 `event_pages`

Per-event microsite settings (one row per event max).

| Column | Type | Default |
|--------|------|---------|
| `id` | UUID PK | |
| `event_id` | UUID UNIQUE → `events` CASCADE | |
| `primary_color` | TEXT | `#00C2FF` |
| `accent_color` | TEXT | `#7C3AED` |
| `bg_color` | TEXT | `#0A0F1E` |
| `text_color` | TEXT | `#FFFFFF` |
| `hero_image_url` | TEXT | |
| `tagline` | TEXT | |
| `hosts` | JSONB | `[]` — `[{name, role, photo_url}]` |
| `schedule` | JSONB | `[]` — `[{time, title, description}]` |
| `dress_code_text` | TEXT | |
| `dress_code_image_url` | TEXT | |
| `gallery` | JSONB | `[]` — `[url, ...]` |
| `rsvp_enabled` | BOOLEAN | `false` |
| `rsvp_message` | TEXT | |
| `venue_lat` | DOUBLE PRECISION | |
| `venue_lng` | DOUBLE PRECISION | |
| `venue_description` | TEXT | |
| `show_countdown` | BOOLEAN | `true` |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### 2.8 `event_rsvps`

RSVP submissions from the public guest page.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `event_id` | UUID → `events` CASCADE | |
| `card_id` | UUID → `event_cards` SET NULL | |
| `attending` | BOOLEAN NOT NULL | |
| `message` | TEXT | Optional congratulatory message |
| `submitted_at` | TIMESTAMPTZ | |

### 2.9 `message_schedules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `event_id` | UUID → `events` | |
| `channel` | TEXT | `sms` / `whatsapp` |
| `title` | TEXT | Display name |
| `body` | TEXT | Message template |
| `sender_id` | TEXT | SMS sender ID |
| `audience` | TEXT | Who to send to |
| `run_at` | TIMESTAMPTZ | When to send |
| `status` | TEXT | `scheduled` / `running` / `done` / `cancelled` |
| `created_at` | TIMESTAMPTZ | |
| `created_by` | TEXT | |

### 2.10 RBAC Tables

| Table | Purpose |
|-------|---------|
| `app_roles` | 7 role keys and labels |
| `app_modules` | 16 module keys (tabs) |
| `role_permissions` | (role, module) → can_view, can_edit |
| `app_users` | Allowlist: email, role, active, last_seen |

---

## 3. Key Functions & Triggers

| Name | Type | Purpose |
|------|------|---------|
| `gen_public_id()` | FUNCTION | 8-char random ID from safe charset |
| `gen_card_code()` | FUNCTION | 4-char display code (3 digits + 1 letter) |
| `trg_events_public_id` | TRIGGER | Auto-assign public_id on event INSERT |
| `trg_event_cards_public_id` | TRIGGER | Auto-assign public_id on card INSERT |
| `trg_event_cards_card_code` | TRIGGER | Auto-assign card_code on card INSERT |
| `is_active_user()` | FUNCTION | Returns TRUE if caller is in app_users (active) |
| `has_perm(module, edit)` | FUNCTION | Checks role_permissions for caller |
| `has_any_perm(modules[], edit)` | FUNCTION | OR over multiple modules |
| `scan_card(...)` | FUNCTION | Atomic door check-in (SECURITY DEFINER) |
| `public_guest_card(...)` | FUNCTION | Public guest data (SECURITY DEFINER) |
| `public_event_page_data(...)` | FUNCTION | Full microsite data (SECURITY DEFINER) |
| `submit_rsvp(...)` | FUNCTION | RSVP submission (SECURITY DEFINER) |

---

## 4. Indexes

```sql
idx_event_cards_event_id        ON event_cards(event_id)
idx_events_created_at           ON events(created_at DESC)
idx_saved_templates_created     ON saved_templates(created_at DESC)
idx_event_logs_event_created    ON event_logs(event_id, created_at DESC)
idx_leads_status_followup       ON leads(status, next_followup_date)
idx_leads_created               ON leads(created_at DESC)
idx_lead_followups_lead         ON lead_followups(lead_id, created_at DESC)
idx_customers_phone             ON customers(phone)
idx_events_customer             ON events(customer_id)
idx_event_transactions_event    ON event_transactions(event_id)
```

---

## 5. Running the Schema

```bash
# In Supabase SQL Editor → New Query, paste and run:
# 1. supabase-schema.sql  (creates all tables, RLS, grants)
# (supabase-roles-settings-scan.sql is included at the end of schema.sql)

# Safe to re-run — all statements use IF NOT EXISTS / OR REPLACE
```

---

## 6. Security Rules Summary

| Access | Who |
|--------|-----|
| All app tables (CRUD) | `authenticated` only |
| Delete on critical tables | `superuser` role only (RESTRICTIVE policy) |
| `event_logs` | INSERT + SELECT only (no UPDATE/DELETE) |
| Public pages (no login) | Via SECURITY DEFINER RPCs only |
| Anon role | Zero direct table access — no exceptions |
| Storage bucket `wa-cards` | Public read (WhatsApp needs public URLs) |
| Storage bucket `event-pages` | Public read (microsite images) |
| Other storage | Authenticated only |

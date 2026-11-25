-- Cloudflare D1 (SQLite) schema for Nikadi Studio
-- Idempotent — safe to run multiple times.
-- Converted from supabase-schema.sql; auth.jwt() / RLS / pg_net replaced by Worker code.
--
-- Setup:
--   npx wrangler d1 create nikadi-studio
--   npx wrangler d1 execute nikadi-studio --remote --file=studio/d1-schema.sql
--
-- Local dev (wrangler dev):
--   npx wrangler d1 execute nikadi-studio --local --file=studio/d1-schema.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0. AUTH SESSIONS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CUSTOMERS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT,
  email       TEXT,
  company     TEXT,
  region      TEXT,
  notes       TEXT,
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. EVENTS  (lead_id is TEXT with no FK — events ↔ leads is circular)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS events (
  id                 TEXT PRIMARY KEY,
  username           TEXT NOT NULL DEFAULT '',
  phone              TEXT,
  event_type         TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  venue_name         TEXT,
  venue_address      TEXT,
  venue_location     TEXT,
  start_datetime     TEXT,
  end_datetime       TEXT,
  cover_image_url    TEXT,
  elements_layout    TEXT,          -- JSON
  sms_message        TEXT,
  sms_draft          TEXT,
  sms_messages       TEXT NOT NULL DEFAULT '[]',  -- JSON array
  customer_id        TEXT REFERENCES customers(id) ON DELETE SET NULL,
  lead_id            TEXT,          -- no FK — circular with leads
  package_price      REAL,
  region             TEXT,
  sms_sender_id      TEXT,
  wa_template        TEXT,
  card_footer        TEXT,          -- JSON
  scan_code          TEXT UNIQUE,
  view_code          TEXT UNIQUE,
  public_id          TEXT UNIQUE,
  guest_link_enabled INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. LEADS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL DEFAULT '',
  phone              TEXT,
  email              TEXT,
  event_type         TEXT,
  event_date         TEXT,
  venue              TEXT,
  region             TEXT,
  description        TEXT,
  package_price      REAL,
  status             TEXT NOT NULL DEFAULT 'new',
  next_followup_date TEXT,
  customer_id        TEXT REFERENCES customers(id) ON DELETE SET NULL,
  event_id           TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_by         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. LEAD FOLLOWUPS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lead_followups (
  id                 TEXT PRIMARY KEY,
  lead_id            TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  method             TEXT,
  note               TEXT,
  next_followup_date TEXT,
  created_by         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead ON lead_followups(lead_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. SAVED TEMPLATES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS saved_templates (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  cover_image_url  TEXT,
  elements_layout  TEXT,     -- JSON
  is_public        INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. EVENT CARDS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_cards (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  public_id       TEXT,
  card_code       TEXT UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  card_type       TEXT,
  phone           TEXT,
  wa_status       TEXT NOT NULL DEFAULT 'idle',
  sms_status      TEXT NOT NULL DEFAULT 'pending',
  max_scans       INTEGER NOT NULL DEFAULT 1,
  scan_count      INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT,
  call_status     TEXT,
  call_comment    TEXT,
  call_updated_at TEXT,
  call_by         TEXT,
  card_url        TEXT,
  sent_at         TEXT,
  status_reset_at TEXT,
  in_list         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_cards_event ON event_cards(event_id, name);
CREATE INDEX IF NOT EXISTS idx_event_cards_phone ON event_cards(phone);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. EVENT LOGS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_logs (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  action          TEXT NOT NULL,
  status          TEXT,
  recipient_name  TEXT,
  recipient_phone TEXT,
  message_title   TEXT,
  detail          TEXT,
  user_email      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_logs_event ON event_logs(event_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. EVENT ASSIGNMENTS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_assignments (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  task       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, email)
);
CREATE INDEX IF NOT EXISTS idx_event_assignments_event ON event_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_assignments_email ON event_assignments(email);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. EVENT PAGES (RSVP settings per event)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_pages (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rsvp_notify_phone TEXT,
  rsvp_message      TEXT,
  settings          TEXT,   -- JSON
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. FINANCE
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance_accounts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'bank',
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_transactions (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  account_id  TEXT REFERENCES finance_accounts(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  amount      REAL NOT NULL,
  txn_date    TEXT NOT NULL,
  party       TEXT,
  category    TEXT,
  reference   TEXT,
  note        TEXT,
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_txns_event ON event_transactions(event_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. SCAN LOGS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS scan_logs (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  card_id     TEXT REFERENCES event_cards(id) ON DELETE SET NULL,
  scan_count  INTEGER NOT NULL DEFAULT 1,
  scanned_by  TEXT,
  scanned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_logs_event ON scan_logs(event_id, scanned_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. ROLES, MODULES, PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_roles (
  key              TEXT PRIMARY KEY,
  label            TEXT NOT NULL DEFAULT '',
  sort             INTEGER NOT NULL DEFAULT 0,
  sees_all_events  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_modules (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role     TEXT NOT NULL,
  module   TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_edit INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role, module)
);

CREATE TABLE IF NOT EXISTS app_users (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'viewer',
  active     INTEGER NOT NULL DEFAULT 1,
  last_seen  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_templates (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  display_name       TEXT,
  account            TEXT,
  is_default         INTEGER NOT NULL DEFAULT 0,
  quick_reply_fields TEXT,   -- JSON array
  settings           TEXT,   -- JSON
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sender_ids (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  sender_id  TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_type_rules (
  id         TEXT PRIMARY KEY,
  card_type  TEXT NOT NULL,
  people     INTEGER NOT NULL DEFAULT 1,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. MESSAGE SCHEDULES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS message_schedules (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,
  message_key TEXT NOT NULL DEFAULT 'main',
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  sent_by     TEXT NOT NULL DEFAULT 'server',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_schedules_event ON message_schedules(event_id);

CREATE TABLE IF NOT EXISTS message_schedule_runs (
  id           TEXT PRIMARY KEY,
  schedule_id  TEXT NOT NULL REFERENCES message_schedules(id) ON DELETE CASCADE,
  event_id     TEXT NOT NULL DEFAULT '',   -- denormalised from schedule
  run_at       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  sent         INTEGER,
  failed       INTEGER,
  skipped      INTEGER,
  detail       TEXT,
  started_at   TEXT,
  finished_at  TEXT,
  locked_until TEXT,
  worker_id    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_runs_schedule ON message_schedule_runs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_msg_runs_event    ON message_schedule_runs(event_id);
CREATE INDEX IF NOT EXISTS idx_msg_runs_pending  ON message_schedule_runs(run_at, status);

CREATE TABLE IF NOT EXISTS message_run_targets (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES message_schedule_runs(id) ON DELETE CASCADE,
  targets    TEXT NOT NULL DEFAULT '{}',   -- JSON {list, note}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. MESSAGE DELIVERIES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS message_deliveries (
  id              TEXT PRIMARY KEY,
  message_id      TEXT UNIQUE,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_card_id   TEXT REFERENCES event_cards(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL,
  message_key     TEXT NOT NULL DEFAULT 'custom',
  message_title   TEXT,
  recipient_name  TEXT,
  phone           TEXT,
  schedule_run_id TEXT REFERENCES message_schedule_runs(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'sent',
  status_id       INTEGER,
  status_group    INTEGER,
  status_name     TEXT,
  reason          TEXT,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  done_at         TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  source          TEXT NOT NULL DEFAULT 'send',
  reply_text      TEXT,
  replied_at      TEXT,
  checked_at      TEXT,
  checks          INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliveries_event   ON message_deliveries(event_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_card    ON message_deliveries(event_card_id, channel, message_key, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON message_deliveries(sent_at, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_msg_id  ON message_deliveries(message_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. FEEDBACK
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_feedback (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'idea',
  rating     INTEGER,
  message    TEXT NOT NULL DEFAULT '',
  page       TEXT,
  event_id   TEXT REFERENCES events(id) ON DELETE SET NULL,
  device     TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  reply      TEXT,
  replied_by TEXT,
  replied_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON app_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_author  ON app_feedback(created_by);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Seed: roles, modules, permissions (matches DEFAULT_MATRIX in src/lib/permissions.js)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO app_roles (key, label, sort, sees_all_events) VALUES
  ('superuser', 'Super Admin',    1, 1),
  ('admin',     'Admin',          2, 1),
  ('designer',  'Designer',       3, 0),
  ('analyst',   'Analyst',        4, 0),
  ('sales',     'Sales',          5, 0),
  ('finance',   'Finance Officer',6, 1),
  ('viewer',    'Viewer',         7, 0);

INSERT OR IGNORE INTO app_modules (key, label, sort) VALUES
  ('events',    'Events',    1),
  ('design',    'Design',    2),
  ('sms',       'SMS',       3),
  ('whatsapp',  'WhatsApp',  4),
  ('reports',   'Reports',   5),
  ('scanner',   'Scanner',   6),
  ('calls',     'Calls',     7),
  ('schedules', 'Schedules', 8),
  ('leads',     'Leads',     9),
  ('customers', 'Customers', 10),
  ('finance',   'Finance',   11),
  ('settings',  'Settings',  12),
  ('history',   'History',   13),
  ('feedback',  'Feedback',  16);

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'superuser', key, 1, 1 FROM app_modules;

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'admin', key, 1, CASE WHEN key = 'settings' THEN 0 ELSE 1 END FROM app_modules;

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'designer', key, 1, 1 FROM app_modules WHERE key IN ('design','scanner','history','events');

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'analyst', key, 1, 0 FROM app_modules WHERE key IN ('reports','history','events','scanner');

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'sales', key, 1, 1 FROM app_modules WHERE key IN ('leads','customers','events','history');

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'finance', key, 1, 1 FROM app_modules WHERE key IN ('finance','events','history');

INSERT OR IGNORE INTO role_permissions (role, module, can_view, can_edit)
SELECT 'viewer', key, 1, 0 FROM app_modules;

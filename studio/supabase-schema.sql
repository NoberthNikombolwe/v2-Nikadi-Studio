-- =====================================================================
-- NIKADI STUDIO — Supabase Schema
-- Run this in your Supabase project: SQL Editor > New Query
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards
-- =====================================================================

-- Events table (one row per event/batch)
CREATE TABLE IF NOT EXISTS events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username        TEXT NOT NULL,
  phone           TEXT,
  event_type      TEXT,
  status          TEXT DEFAULT 'active',
  venue_name      TEXT,
  venue_address   TEXT,
  venue_location  TEXT,
  start_datetime  TIMESTAMPTZ,
  end_datetime    TIMESTAMPTZ,
  cover_image_url TEXT,
  elements_layout JSONB,        -- saved card element positions / sizes / colors
  sms_message     TEXT,         -- per-event SMS message template (manual "Save Template")
  sms_draft       TEXT,         -- autosaved SMS working copy
  sms_messages    JSONB DEFAULT '[]'::jsonb, -- extra SMS messages (title, body, recipients source, per-message statuses)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS elements_layout JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_message TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_draft TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_messages JSONB DEFAULT '[]'::jsonb;

-- Cards table (one row per attendee/contact in an event)
CREATE TABLE IF NOT EXISTS event_cards (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT,
  card_type   TEXT,
  phone       TEXT,
  wa_status   TEXT DEFAULT 'idle',
  sms_status  TEXT DEFAULT 'pending',
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Event history (append-only audit log): one row per card sent, SMS sent, card upload,
-- late delivery report, bulk-send summary or event change. Signed-in users can add and
-- read rows but never edit or delete them; user_email is filled in by the database from
-- the caller's login, so it can't be spoofed from the browser.
CREATE TABLE IF NOT EXISTS event_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id        UUID REFERENCES events(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT clock_timestamp(),   -- per row, so a bulk insert keeps its order
  user_email      TEXT DEFAULT (auth.jwt() ->> 'email'),
  channel         TEXT,         -- whatsapp | sms | card | event
  action          TEXT,         -- send | status | upload | bulk | create | update | contacts
  status          TEXT,         -- sent | delivered | invalid | not_sent | failed | ok
  recipient_name  TEXT,
  recipient_phone TEXT,
  message_title   TEXT,         -- SMS message title or WhatsApp template
  detail          TEXT
);

-- ── CRM: customers, leads and their follow-ups ──────────────────────────
-- A lead is a prospective event (name, phone, event details, package price). Follow-ups
-- record each contact with the lead. Qualifying a lead creates (or reuses, by phone) a
-- customer and usually an event; one customer can have many events.
CREATE TABLE IF NOT EXISTS customers (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,                     -- normalised, e.g. 255712345678
  region      TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  TEXT DEFAULT (auth.jwt() ->> 'email')
);

CREATE TABLE IF NOT EXISTS leads (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name               TEXT NOT NULL,
  phone              TEXT,
  event_type         TEXT,
  event_date         DATE,
  package_price      NUMERIC(12,2),     -- TZS: 800 / 1000 / 1200 / 1500 or a custom amount
  region             TEXT,
  venue              TEXT,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'new',   -- new | contacted | qualified | lost
  next_followup_date DATE,              -- from the latest follow-up; drives the "due" list
  customer_id        UUID REFERENCES customers(id) ON DELETE SET NULL,
  event_id           UUID REFERENCES events(id)    ON DELETE SET NULL,
  qualified_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  created_by         TEXT DEFAULT (auth.jwt() ->> 'email')
);

CREATE TABLE IF NOT EXISTS lead_followups (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id            UUID REFERENCES leads(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ DEFAULT clock_timestamp(),
  created_by         TEXT DEFAULT (auth.jwt() ->> 'email'),
  method             TEXT,              -- call | whatsapp | sms | meeting | other
  note               TEXT NOT NULL,
  next_followup_date DATE
);

-- Events belong to a customer and remember the lead they came from
ALTER TABLE events ADD COLUMN IF NOT EXISTS customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_id       UUID REFERENCES leads(id)     ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS package_price NUMERIC(12,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS region        TEXT;

-- ── Finance: accounts and per-event transactions ────────────────────────
-- finance_accounts are the business's own money accounts (bank, mobile money, cash).
-- event_transactions record every income received and expense paid for an event:
-- amount, date, which account it went into / came out of, and the other party
-- (who sent the money, or who was paid).
CREATE TABLE IF NOT EXISTS finance_accounts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,                  -- e.g. "CRDB Bank", "M-Pesa Till"
  type        TEXT NOT NULL DEFAULT 'bank',   -- bank | mobile | cash | other
  number      TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  TEXT DEFAULT (auth.jwt() ->> 'email')
);

CREATE TABLE IF NOT EXISTS event_transactions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  txn_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id  UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
  party       TEXT,                           -- income: who sent it; expense: who was paid
  category    TEXT,
  reference   TEXT,                           -- bank / mobile-money transaction reference
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  TEXT DEFAULT (auth.jwt() ->> 'email')
);
CREATE INDEX IF NOT EXISTS idx_event_transactions_event ON event_transactions(event_id);

-- Saved templates table (reusable card designs)
CREATE TABLE IF NOT EXISTS saved_templates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  cover_image_url TEXT,
  elements_layout JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_event_cards_event_id    ON event_cards(event_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at       ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_templates_created ON saved_templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_event_created ON event_logs(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status_followup   ON leads(status, next_followup_date);
CREATE INDEX IF NOT EXISTS idx_leads_created           ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead     ON lead_followups(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_phone         ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_events_customer         ON events(customer_id);

-- =====================================================================
-- ROW LEVEL SECURITY
-- Only signed-in users can read or write app data. The anon/publishable key
-- ships inside the browser bundle, so anything granted to `anon` is public:
-- never add anon policies for these tables.
--
-- Every signed-in user can see every event (there is no per-user ownership yet),
-- so also restrict WHO can sign in: Supabase Dashboard > Authentication >
-- Sign In / Providers > turn OFF "Allow new users to sign up", then invite the
-- team members (or keep sign-up on only while onboarding them).
-- =====================================================================
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_followups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_transactions ENABLE ROW LEVEL SECURITY;

-- Legacy wide-open policies (anyone holding the anon key had full access)
DROP POLICY IF EXISTS "allow_all_events"            ON events;
DROP POLICY IF EXISTS "allow_all_event_cards"       ON event_cards;
DROP POLICY IF EXISTS "allow_all_saved_templates"   ON saved_templates;

DROP POLICY IF EXISTS "authenticated_all_events"            ON events;
DROP POLICY IF EXISTS "authenticated_all_event_cards"       ON event_cards;
DROP POLICY IF EXISTS "authenticated_all_saved_templates"   ON saved_templates;

CREATE POLICY "authenticated_all_events"          ON events           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_event_cards"     ON event_cards      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_saved_templates" ON saved_templates  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_customers"      ON customers;
DROP POLICY IF EXISTS "authenticated_all_leads"          ON leads;
DROP POLICY IF EXISTS "authenticated_all_lead_followups" ON lead_followups;
CREATE POLICY "authenticated_all_customers"      ON customers      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_leads"          ON leads          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_lead_followups" ON lead_followups FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_finance_accounts"   ON finance_accounts;
DROP POLICY IF EXISTS "authenticated_all_event_transactions" ON event_transactions;
CREATE POLICY "authenticated_all_finance_accounts"   ON finance_accounts   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_event_transactions" ON event_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- event_logs is append-only: read + insert (as yourself) only, no update/delete policies
DROP POLICY IF EXISTS "authenticated_read_event_logs"   ON event_logs;
DROP POLICY IF EXISTS "authenticated_insert_event_logs" ON event_logs;
CREATE POLICY "authenticated_read_event_logs"   ON event_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_event_logs" ON event_logs FOR INSERT TO authenticated
  WITH CHECK (user_email IS NOT DISTINCT FROM (auth.jwt() ->> 'email'));

-- =====================================================================
-- GRANTS  (Supabase requires explicit grants for the Data API on new tables)
-- The app requires login, so anon gets nothing; signed-in users get CRUD.
-- =====================================================================
REVOKE ALL ON public.events          FROM anon;
REVOKE ALL ON public.event_cards     FROM anon;
REVOKE ALL ON public.saved_templates FROM anon;
REVOKE ALL ON public.event_logs      FROM anon;
REVOKE ALL ON public.customers       FROM anon;
REVOKE ALL ON public.leads           FROM anon;
REVOKE ALL ON public.lead_followups  FROM anon;
REVOKE ALL ON public.finance_accounts   FROM anon;
REVOKE ALL ON public.event_transactions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_cards     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_templates TO authenticated;
REVOKE UPDATE, DELETE ON public.event_logs FROM authenticated;
GRANT SELECT, INSERT                 ON public.event_logs      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_followups  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_accounts   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_transactions TO authenticated;

-- service_role: Edge Functions and other server-side calls
GRANT ALL ON public.events          TO service_role;
GRANT ALL ON public.event_cards     TO service_role;
GRANT ALL ON public.saved_templates TO service_role;
GRANT ALL ON public.event_logs      TO service_role;
GRANT ALL ON public.customers       TO service_role;
GRANT ALL ON public.leads           TO service_role;
GRANT ALL ON public.lead_followups  TO service_role;
GRANT ALL ON public.finance_accounts   TO service_role;
GRANT ALL ON public.event_transactions TO service_role;

-- =====================================================================
-- STORAGE BUCKETS
--   templates : card background images (read back by the app via public URL)
--   wa-cards  : per-guest rendered card JPEGs; the WhatsApp provider fetches
--               them by public URL, so the bucket must stay public
-- Public buckets serve files by URL without any policy; the policies below only
-- control who can upload and list. Size and MIME limits stop the buckets being
-- used to host arbitrary files.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('templates', 'templates', true, 10485760,
     ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  ('wa-cards',  'wa-cards',  true,  5242880,
     ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Legacy policies (public upload/listing)
DROP POLICY IF EXISTS "public_read_templates"   ON storage.objects;
DROP POLICY IF EXISTS "public_insert_templates" ON storage.objects;

DROP POLICY IF EXISTS "authenticated_read_templates"   ON storage.objects;
DROP POLICY IF EXISTS "authenticated_insert_templates" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_templates" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_wa_cards"    ON storage.objects;
DROP POLICY IF EXISTS "authenticated_insert_wa_cards"  ON storage.objects;

CREATE POLICY "authenticated_read_templates"
  ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'templates');
CREATE POLICY "authenticated_insert_templates"
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'templates');
CREATE POLICY "authenticated_delete_templates"
  ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'templates');
CREATE POLICY "authenticated_read_wa_cards"
  ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'wa-cards');
CREATE POLICY "authenticated_insert_wa_cards"
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'wa-cards');

-- If the wa-cards bucket was created by hand in the dashboard earlier, also open
-- Storage > Policies and delete any leftover policy that grants INSERT/SELECT to
-- `anon` or `public` on it — this script can't know their names.

-- Tell the Data API (PostgREST) to reload its schema cache so new tables are usable at once
NOTIFY pgrst, 'reload schema';

-- ===== BEGIN roles-settings-scan (copy of supabase-roles-settings-scan.sql) =====
-- =====================================================================
-- NIKADI STUDIO — Roles & permissions, Settings, Scanner & Calls
-- Run AFTER supabase-schema.sql (it is also appended to the end of that
-- file, so running the full schema always ends with these rules).
-- Safe to re-run.
--
--   1. Roles, modules, permissions, invited users
--   2. Permission helpers used by every policy
--   3. Settings: general values, WhatsApp templates, sender IDs, card types
--   4. Scanner (check-in) + phone-call tracking
--   5. Row level security rewritten per module
--   6. Public (no-login) scan page RPCs, code-protected
--   7. View-only share link (code-protected RPCs)
--   8. Storage usage and clearing card images
--   9. Message schedules (SMS / WhatsApp sent later by pg_cron + run-schedules)
--  10. Feedback from users about the system
--  11. Delivery reports (every send's provider id + its delivered / read / failed result)
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. ROLES, MODULES, PERMISSIONS, USERS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_roles (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  sort        INT  NOT NULL DEFAULT 0
);
INSERT INTO app_roles (key, label, description, sort) VALUES
  ('superuser',         'Super Admin',       'Sees and manages everything — the only role that can delete data', 0),
  ('admin',             'Admin',             'Runs the system day to day; manages users and settings', 1),
  ('sales_officer',     'Sales Officer',     'Leads, customers and events', 2),
  ('graphics_designer', 'Graphics Designer', 'Card design, guest lists and WhatsApp delivery', 3),
  ('help_desk',         'Help Desk',         'Door check-in, guest calls and SMS support', 4),
  ('telesales',         'Tele Sales',        'Phone follow-ups and guest confirmation calls', 5),
  ('finance_officer',   'Finance Officer',   'Income, expenses and event profit', 6)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, sort = EXCLUDED.sort;

CREATE TABLE IF NOT EXISTS app_modules (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort  INT  NOT NULL DEFAULT 0
);
INSERT INTO app_modules (key, label, sort) VALUES
  ('events','Events',1), ('leads','Leads',2), ('customers','Customers',3), ('design','Design',4),
  ('vcard','VCard',5), ('sms','SMS',6), ('whatsapp','WhatsApp',7), ('batch','Batch & Send',8),
  ('reports','Reports',9), ('history','History',10), ('finance','Finance',11), ('scanner','Scanner',12),
  ('calls','Calls',13), ('settings','Settings',14), ('users','Users & roles',15)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, sort = EXCLUDED.sort;

CREATE TABLE IF NOT EXISTS role_permissions (
  role      TEXT REFERENCES app_roles(key)   ON DELETE CASCADE,
  module    TEXT REFERENCES app_modules(key) ON DELETE CASCADE,
  can_view  BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role, module)
);

-- Default matrix (mirrors DEFAULT_MATRIX in src/lib/permissions.js). 'E' = view + edit, 'V' = view.
-- Only inserted when missing, so changes made in Settings are never overwritten.
INSERT INTO role_permissions (role, module, can_view, can_edit)
SELECT r, m, TRUE, (p = 'E') FROM (VALUES
  ('admin','events','E'),('admin','leads','E'),('admin','customers','E'),('admin','design','E'),('admin','vcard','E'),
  ('admin','sms','E'),('admin','whatsapp','E'),('admin','batch','E'),('admin','reports','E'),('admin','history','E'),
  ('admin','finance','E'),('admin','scanner','E'),('admin','calls','E'),('admin','settings','E'),('admin','users','E'),
  ('sales_officer','events','E'),('sales_officer','leads','E'),('sales_officer','customers','E'),('sales_officer','design','V'),
  ('sales_officer','vcard','V'),('sales_officer','batch','V'),('sales_officer','sms','E'),('sales_officer','whatsapp','V'),
  ('sales_officer','reports','V'),('sales_officer','history','V'),('sales_officer','calls','V'),
  ('graphics_designer','events','V'),('graphics_designer','design','E'),('graphics_designer','vcard','E'),
  ('graphics_designer','batch','E'),('graphics_designer','whatsapp','E'),('graphics_designer','reports','V'),('graphics_designer','history','V'),
  ('help_desk','events','V'),('help_desk','customers','V'),('help_desk','sms','E'),('help_desk','reports','V'),
  ('help_desk','history','V'),('help_desk','scanner','E'),('help_desk','calls','E'),
  ('telesales','events','V'),('telesales','leads','E'),('telesales','customers','V'),('telesales','sms','E'),
  ('telesales','reports','V'),('telesales','calls','E'),
  ('finance_officer','events','V'),('finance_officer','customers','V'),('finance_officer','reports','V'),
  ('finance_officer','history','V'),('finance_officer','finance','E')
) AS t(r, m, p)
ON CONFLICT (role, module) DO NOTHING;

-- Everyone allowed to use the system. Sign-in is by invitation: an email must be here (and active).
CREATE TABLE IF NOT EXISTS app_users (
  email        TEXT PRIMARY KEY CHECK (email = lower(email)),
  user_id      UUID UNIQUE,
  full_name    TEXT,
  role         TEXT NOT NULL REFERENCES app_roles(key),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by   TEXT DEFAULT (auth.jwt() ->> 'email'),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

-- >>> SUPER ADMINS (role key 'superuser'): the owner accounts. Edit this list if needed BEFORE the first run. <<<
INSERT INTO app_users (email, role, full_name, invited_by) VALUES
  ('noberthbariki@gmail.com',    'superuser', NULL, 'setup'),
  ('nnikombolwe@simusolar.com',  'superuser', NULL, 'setup')
ON CONFLICT (email) DO UPDATE SET role = 'superuser', active = TRUE;

-- Everyone who already has an account keeps access (as Admin) so nobody is locked out;
-- a Superuser can change their roles in Settings → Users.
INSERT INTO app_users (email, user_id, full_name, role, invited_by)
SELECT lower(u.email), u.id, u.raw_user_meta_data ->> 'full_name', 'admin', 'existing account'
FROM auth.users u WHERE u.email IS NOT NULL
ON CONFLICT (email) DO UPDATE SET user_id = COALESCE(app_users.user_id, EXCLUDED.user_id);

-- Which roles see every event. Everyone else sees only events they're assigned to or created.
-- Set once when the column is first added; change it later in Settings → Roles & permissions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_roles' AND column_name = 'sees_all_events') THEN
    ALTER TABLE app_roles ADD COLUMN sees_all_events BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE app_roles SET sees_all_events = TRUE WHERE key IN ('superuser','admin','finance_officer');
  END IF;
END $$;

-- Who created each event (they always keep access to it)
ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT (auth.jwt() ->> 'email');

-- Event team: users assigned to an event, with what they do there
CREATE TABLE IF NOT EXISTS event_assignments (
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  email       TEXT REFERENCES app_users(email) ON DELETE CASCADE ON UPDATE CASCADE,
  task        TEXT,                      -- e.g. Designer, Door / check-in
  assigned_by TEXT DEFAULT (auth.jwt() ->> 'email'),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, email)
);
CREATE INDEX IF NOT EXISTS idx_event_assignments_email ON event_assignments(email);

-- Invitation gate: runs for every way an auth user is created (Google, email, API)
CREATE OR REPLACE FUNCTION public.enforce_invited_signup() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_users a WHERE a.email = lower(NEW.email) AND a.active) THEN
    RAISE EXCEPTION 'Nikadi Studio is by invitation only. Ask an administrator to invite %.', NEW.email;
  END IF;
  UPDATE app_users SET user_id = NEW.id,
         full_name = COALESCE(full_name, NEW.raw_user_meta_data ->> 'full_name')
   WHERE email = lower(NEW.email);
  RETURN NEW;
END $$;
-- The older scanner-branch SQL used an allowed_users list; app_users replaces it
DROP TRIGGER IF EXISTS trg_enforce_allowed_signup ON auth.users;
DROP TRIGGER IF EXISTS trg_enforce_invited_signup ON auth.users;
CREATE TRIGGER trg_enforce_invited_signup BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invited_signup();

-- ─────────────────────────────────────────────────────────────────────
-- 2. PERMISSION HELPERS (SECURITY DEFINER so policies can call them cheaply)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM app_users WHERE email = lower(auth.jwt() ->> 'email') AND active
$$;

CREATE OR REPLACE FUNCTION public.is_active_user() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.my_role() IS NOT NULL
$$;

-- Super Admin (role key 'superuser'): always true. Otherwise the role's row in role_permissions decides.
CREATE OR REPLACE FUNCTION public.has_perm(p_module TEXT, p_edit BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.my_role() IS NULL        THEN FALSE
    WHEN public.my_role() = 'superuser'  THEN TRUE
    ELSE COALESCE((SELECT CASE WHEN p_edit THEN rp.can_edit ELSE (rp.can_view OR rp.can_edit) END
                     FROM role_permissions rp WHERE rp.role = public.my_role() AND rp.module = p_module), FALSE)
  END
$$;

CREATE OR REPLACE FUNCTION public.has_any_perm(p_modules TEXT[], p_edit BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(p_modules) m WHERE public.has_perm(m, p_edit))
$$;

-- Does my role see every event?
CREATE OR REPLACE FUNCTION public.sees_all_events() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.my_role() = 'superuser'
      OR COALESCE((SELECT r.sees_all_events FROM app_roles r WHERE r.key = public.my_role()), FALSE)
$$;

-- May I see this event? (sees-all role, assigned to it, or created it)
CREATE OR REPLACE FUNCTION public.can_see_event(p_event UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND (
    public.sees_all_events()
    OR EXISTS (SELECT 1 FROM event_assignments a WHERE a.event_id = p_event AND a.email = lower(auth.jwt() ->> 'email'))
    OR EXISTS (SELECT 1 FROM events e WHERE e.id = p_event AND lower(e.created_by) = lower(auth.jwt() ->> 'email'))
  )
$$;

REVOKE ALL ON FUNCTION public.sees_all_events(), public.can_see_event(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sees_all_events(), public.can_see_event(UUID) TO authenticated, service_role;

-- The person who creates an event joins its team as Owner
CREATE OR REPLACE FUNCTION public.assign_event_creator() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me TEXT := lower(auth.jwt() ->> 'email');
BEGIN
  IF me IS NOT NULL AND EXISTS (SELECT 1 FROM app_users WHERE email = me) THEN
    INSERT INTO event_assignments (event_id, email, task, assigned_by) VALUES (NEW.id, me, 'Owner', me)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assign_event_creator ON events;
CREATE TRIGGER trg_assign_event_creator AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION public.assign_event_creator();

-- People who may be put on an event team (for the picker; the users list itself is admin-only)
CREATE OR REPLACE FUNCTION public.assignable_users() RETURNS TABLE (email TEXT, full_name TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email, u.full_name, u.role FROM app_users u
   WHERE u.active AND public.has_any_perm(ARRAY['events','users'], TRUE)
   ORDER BY COALESCE(u.full_name, u.email)
$$;
REVOKE ALL ON FUNCTION public.assignable_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.assignable_users() TO authenticated;

REVOKE ALL ON FUNCTION public.my_role(), public.is_active_user(), public.has_perm(TEXT, BOOLEAN), public.has_any_perm(TEXT[], BOOLEAN) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.my_role(), public.is_active_user(), public.has_perm(TEXT, BOOLEAN), public.has_any_perm(TEXT[], BOOLEAN) TO authenticated, service_role;

-- Records "last seen" for the signed-in user (called by the app on start)
CREATE OR REPLACE FUNCTION public.touch_last_seen() RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE app_users SET last_seen_at = NOW(),
         user_id = COALESCE(user_id, auth.uid())
   WHERE email = lower(auth.jwt() ->> 'email')
$$;
REVOKE ALL ON FUNCTION public.touch_last_seen() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

-- Only a Superuser can create, change or remove a Superuser; the last active one stays
CREATE OR REPLACE FUNCTION public.guard_app_users() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller TEXT := public.my_role();
BEGIN
  IF caller IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- SQL editor / service role
  IF caller <> 'superuser' AND (
       (TG_OP <> 'INSERT' AND OLD.role = 'superuser') OR (TG_OP <> 'DELETE' AND NEW.role = 'superuser')) THEN
    RAISE EXCEPTION 'Only a Super Admin can manage Super Admin accounts';
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.role = 'superuser' AND OLD.active
     AND (TG_OP = 'DELETE' OR NEW.role <> 'superuser' OR NOT NEW.active)
     AND (SELECT count(*) FROM app_users WHERE role = 'superuser' AND active AND email <> OLD.email) = 0 THEN
    RAISE EXCEPTION 'At least one active Super Admin must remain';
  END IF;
  IF TG_OP <> 'DELETE' THEN NEW.email := lower(trim(NEW.email)); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_guard_app_users ON app_users;
CREATE TRIGGER trg_guard_app_users BEFORE INSERT OR UPDATE OR DELETE ON app_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_app_users();

-- ─────────────────────────────────────────────────────────────────────
-- 3. SETTINGS (dynamic data)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT DEFAULT (auth.jwt() ->> 'email')
);
INSERT INTO app_settings (key, value) VALUES
  ('org_name',           '"Nikadi Studio"'),
  ('country_code',       '"255"'),
  ('wa_account',         '"Nikadi"'),
  ('numeric_card_types', 'true'),     -- a card type that is just a number ("5") admits that many
  ('default_people',     '1')         -- unknown card types admit this many
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS wa_templates (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,      -- the template name registered with the WhatsApp provider
  label            TEXT,
  account          TEXT,                      -- provider account; NULL = app_settings.wa_account
  has_image_header BOOLEAN NOT NULL DEFAULT TRUE,
  preview          TEXT,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort             INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO wa_templates (name, label, is_default, sort) VALUES
  ('Mwaliko',   'Mwaliko (invitation)', TRUE, 1),
  ('Mchango',   'Mchango (contribution)', FALSE, 2),
  ('ImageTemp', 'Image only', FALSE, 3)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS sender_ids (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id  TEXT NOT NULL UNIQUE CHECK (sender_id ~ '^[A-Za-z0-9 ]{1,11}$'),
  label      TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO sender_ids (sender_id, label, is_default) VALUES ('NIKADI', 'Nikadi', TRUE)
ON CONFLICT (sender_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS card_type_rules (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,                  -- matched case-insensitively against event_cards.card_type
  people     INT  NOT NULL CHECK (people BETWEEN 1 AND 1000),
  label      TEXT,
  color      TEXT,
  sort       INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_type_rules_name ON card_type_rules (lower(trim(name)));
INSERT INTO card_type_rules (name, people, label, sort) VALUES
  ('Single', 1, '1 person', 1), ('Double', 2, '2 people', 2), ('Family', 4, '4 people', 3)
ON CONFLICT DO NOTHING;

-- One default at a time for templates and sender IDs
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_templates_default ON wa_templates ((is_default)) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sender_ids_default   ON sender_ids   ((is_default)) WHERE is_default;

-- Per-event choices (NULL = use the default)
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_sender_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS wa_template   TEXT;
-- The "Powered by" footer printed on the event's cards: { brand, phone, bg, bgOpacity, color }
-- (any part unset uses the default; src/lib/cardFooter.js). Edited in Design by clicking the footer.
ALTER TABLE events ADD COLUMN IF NOT EXISTS card_footer   JSONB;

-- ─────────────────────────────────────────────────────────────────────
-- 4. SCANNER + CALLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE events      ADD COLUMN IF NOT EXISTS scan_code       TEXT;   -- NULL = public scan page off
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS max_scans       INT NOT NULL DEFAULT 1;
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS scan_count      INT NOT NULL DEFAULT 0;
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS call_status     TEXT;   -- picked | busy | yes | no | NULL
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS call_comment    TEXT;
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS call_updated_at TIMESTAMPTZ;
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS call_by         TEXT;
DO $$ BEGIN
  ALTER TABLE event_cards ADD CONSTRAINT event_cards_scan_count_valid CHECK (scan_count >= 0 AND scan_count <= max_scans);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The older scanner-branch SQL stored P / B; convert to the new values first
UPDATE event_cards SET call_status = CASE lower(call_status) WHEN 'p' THEN 'picked' WHEN 'b' THEN 'busy'
  WHEN 'yes' THEN 'yes' WHEN 'no' THEN 'no' ELSE NULL END
 WHERE call_status IS NOT NULL AND call_status NOT IN ('picked','busy','yes','no');
DO $$ BEGIN
  ALTER TABLE event_cards ADD CONSTRAINT event_cards_call_status_valid CHECK (call_status IS NULL OR call_status IN ('picked','busy','yes','no'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How many people a card admits — mirrors peopleForCardType() in src/lib/cardRules.js:
-- a matching rule (case-insensitive) → its people; a plain number ("5") → that many
-- (when numeric_card_types is on); anything else → default_people.
CREATE OR REPLACE FUNCTION public.people_for_card_type(p_type TEXT) RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t TEXT := lower(trim(COALESCE(p_type, ''))); n INT;
BEGIN
  SELECT people INTO n FROM card_type_rules WHERE lower(trim(name)) = t;
  IF n IS NOT NULL THEN RETURN n; END IF;
  IF t ~ '^\d{1,4}$' AND COALESCE((SELECT (value)::text::boolean FROM app_settings WHERE key = 'numeric_card_types'), TRUE) THEN
    RETURN GREATEST(t::INT, 1);
  END IF;
  RETURN GREATEST(COALESCE((SELECT (value)::text::int FROM app_settings WHERE key = 'default_people'), 1), 1);
END $$;

-- Keep every card's max_scans in line with its card type (never below what's already scanned)
CREATE OR REPLACE FUNCTION public.sync_card_max_scans() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.max_scans := GREATEST(COALESCE(NEW.scan_count, 0), public.people_for_card_type(NEW.card_type));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_event_cards_max_scans ON event_cards;
DROP FUNCTION IF EXISTS public.sync_event_card_max_scans();
CREATE TRIGGER trg_event_cards_max_scans BEFORE INSERT OR UPDATE OF card_type ON event_cards
  FOR EACH ROW EXECUTE FUNCTION public.sync_card_max_scans();

-- When the rules or the numeric/default settings change, re-apply them to every card
CREATE OR REPLACE FUNCTION public.resync_all_max_scans() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE event_cards SET max_scans = GREATEST(scan_count, public.people_for_card_type(card_type))
   WHERE max_scans IS DISTINCT FROM GREATEST(scan_count, public.people_for_card_type(card_type));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_card_rules_resync ON card_type_rules;
CREATE TRIGGER trg_card_rules_resync AFTER INSERT OR UPDATE OR DELETE ON card_type_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.resync_all_max_scans();
DROP TRIGGER IF EXISTS trg_settings_resync ON app_settings;
CREATE TRIGGER trg_settings_resync AFTER INSERT OR UPDATE ON app_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.resync_all_max_scans();

-- Backfill cards created before this script
UPDATE event_cards SET max_scans = GREATEST(scan_count, public.people_for_card_type(card_type))
 WHERE max_scans IS DISTINCT FROM GREATEST(scan_count, public.people_for_card_type(card_type));

-- Every check-in attempt, accepted or not
CREATE TABLE IF NOT EXISTS scan_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_card_id UUID REFERENCES event_cards(id) ON DELETE CASCADE,
  event_id      UUID REFERENCES events(id) ON DELETE CASCADE,
  method        TEXT NOT NULL CHECK (method IN ('qr','qr_fallback','manual')),
  people        INT  NOT NULL DEFAULT 1,
  accepted      BOOLEAN NOT NULL,
  reason        TEXT,                -- ok | limit_reached | not_found | bad_code
  scanned_by    TEXT,
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Upgrade a scan_logs table created by the older scanner-branch SQL
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS people     INT NOT NULL DEFAULT 1;
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS event_id   UUID REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS reason     TEXT;
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS scanned_by TEXT;
CREATE INDEX IF NOT EXISTS idx_scan_logs_event ON scan_logs(event_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_cards_event ON event_cards(event_id);

-- The ONLY way to check a guest in. Atomic: the UPDATE admits all `p_count` people or none,
-- so two doors scanning the same card at the same moment can never over-admit.
-- Signed-in callers need Scanner (edit); the public page must pass the event's scan code.
DROP FUNCTION IF EXISTS public.scan_card(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.scan_card(UUID, TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.scan_card(
  p_card_id UUID, p_method TEXT, p_count INT DEFAULT 1, p_scanned_by TEXT DEFAULT NULL, p_code TEXT DEFAULT NULL
) RETURNS TABLE (id UUID, name TEXT, card_type TEXT, max_scans INT, scan_count INT, accepted BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row   event_cards%ROWTYPE;
  v_event UUID;
  v_ok    BOOLEAN := FALSE;
  v_why   TEXT;
  v_n     INT := LEAST(GREATEST(COALESCE(p_count, 1), 1), 1000);
  v_by    TEXT := COALESCE(auth.jwt() ->> 'email', NULLIF(trim(p_scanned_by), ''), 'public scan page');
BEGIN
  SELECT c.event_id INTO v_event FROM event_cards c WHERE c.id = p_card_id;
  IF auth.role() = 'authenticated' THEN
    IF NOT public.has_perm('scanner', TRUE) THEN RAISE EXCEPTION 'Your role cannot check guests in'; END IF;
    IF v_event IS NOT NULL AND NOT public.can_see_event(v_event) THEN RAISE EXCEPTION 'You are not assigned to this event'; END IF;
  ELSIF v_event IS NULL OR p_code IS NULL
        OR NOT EXISTS (SELECT 1 FROM events e WHERE e.id = v_event AND e.scan_code IS NOT NULL AND e.scan_code = p_code) THEN
    RETURN QUERY SELECT p_card_id, NULL::TEXT, NULL::TEXT, NULL::INT, NULL::INT, FALSE, 'bad_code'::TEXT;
    RETURN;
  END IF;

  UPDATE event_cards c SET scan_count = c.scan_count + v_n, last_scanned_at = NOW()
   WHERE c.id = p_card_id AND c.scan_count + v_n <= c.max_scans
  RETURNING * INTO v_row;
  IF FOUND THEN v_ok := TRUE; v_why := 'ok';
  ELSE
    SELECT * INTO v_row FROM event_cards c WHERE c.id = p_card_id;
    v_why := CASE WHEN v_row.id IS NULL THEN 'not_found' ELSE 'limit_reached' END;
  END IF;
  INSERT INTO scan_logs (event_card_id, event_id, method, people, accepted, reason, scanned_by)
  VALUES (v_row.id, COALESCE(v_row.event_id, v_event), p_method, v_n, v_ok, v_why, v_by);
  RETURN QUERY SELECT v_row.id, v_row.name, v_row.card_type, v_row.max_scans, v_row.scan_count, v_ok, v_why;
END $$;
REVOKE ALL ON FUNCTION public.scan_card(UUID, TEXT, INT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.scan_card(UUID, TEXT, INT, TEXT, TEXT) TO anon, authenticated;

-- Deletes one guest card that is no longer used (Calls / Scanner → Delete card). Super Admins
-- only, on an event they can see. The delete is written to the event History first (with the
-- card's call answer and check-ins); its scan log goes with it (ON DELETE CASCADE) and its
-- delivery records keep their rows without the card. → { deleted, name }
CREATE OR REPLACE FUNCTION public.delete_guest_card(p_card_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c event_cards%ROWTYPE;
BEGIN
  SELECT * INTO c FROM event_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('deleted', FALSE); END IF;
  IF public.my_role() IS DISTINCT FROM 'superuser' THEN RAISE EXCEPTION 'Only a Super Admin can delete a guest card'; END IF;
  IF NOT public.can_see_event(c.event_id) THEN RAISE EXCEPTION 'You are not assigned to this event'; END IF;
  INSERT INTO event_logs (event_id, channel, action, status, recipient_name, recipient_phone, detail, user_email)
  VALUES (c.event_id, 'event', 'guest_delete', 'ok', c.name, c.phone,
          left(format('Deleted card %s (%s) — call: %s, checked in %s/%s', COALESCE(c.name, '—'), COALESCE(NULLIF(c.card_type, ''), 'no card type'),
                      COALESCE(c.call_status, 'not called'), COALESCE(c.scan_count, 0), COALESCE(c.max_scans, 1)), 500),
          auth.jwt() ->> 'email');
  DELETE FROM event_cards WHERE id = p_card_id;
  RETURN jsonb_build_object('deleted', TRUE, 'name', c.name);
END $$;
REVOKE ALL ON FUNCTION public.delete_guest_card(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_guest_card(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY — per module (replaces the "any signed-in user" policies)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE app_roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_modules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sender_ids       ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_type_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_assignments ENABLE ROW LEVEL SECURITY;

-- Drop the old open policies (and this script's own, so re-runs are clean)
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN
    ('events','event_cards','saved_templates','customers','leads','lead_followups','finance_accounts','event_transactions',
     'event_logs','app_roles','app_modules','role_permissions','app_users','app_settings','wa_templates','sender_ids',
     'card_type_rules','scan_logs','allowed_users','event_assignments')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename); END LOOP;
END $$;

-- Events: every active user can see events; changes depend on the module doing them
CREATE POLICY p_events_select ON events FOR SELECT TO authenticated
  USING (public.can_see_event(id) OR lower(created_by) = lower(auth.jwt() ->> 'email'));
CREATE POLICY p_events_insert ON events FOR INSERT TO authenticated WITH CHECK (public.has_any_perm(ARRAY['events','leads'], TRUE));
CREATE POLICY p_events_update ON events FOR UPDATE TO authenticated
  USING (public.has_any_perm(ARRAY['events','design','sms','whatsapp','scanner'], TRUE) AND public.can_see_event(id))
  WITH CHECK (public.has_any_perm(ARRAY['events','design','sms','whatsapp','scanner'], TRUE));
CREATE POLICY p_events_delete ON events FOR DELETE TO authenticated USING (public.has_perm('events', TRUE) AND public.can_see_event(id));

CREATE POLICY p_cards_select ON event_cards FOR SELECT TO authenticated USING (public.can_see_event(event_id));
CREATE POLICY p_cards_insert ON event_cards FOR INSERT TO authenticated
  WITH CHECK (public.has_any_perm(ARRAY['design','batch','vcard','sms','whatsapp','calls'], TRUE) AND public.can_see_event(event_id));
CREATE POLICY p_cards_update ON event_cards FOR UPDATE TO authenticated
  USING (public.has_any_perm(ARRAY['design','batch','sms','whatsapp','calls','scanner'], TRUE) AND public.can_see_event(event_id))
  WITH CHECK (public.has_any_perm(ARRAY['design','batch','sms','whatsapp','calls','scanner'], TRUE) AND public.can_see_event(event_id));
CREATE POLICY p_cards_delete ON event_cards FOR DELETE TO authenticated
  USING (public.has_any_perm(ARRAY['design','batch'], TRUE) AND public.can_see_event(event_id));

CREATE POLICY p_templates_select ON saved_templates FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY p_templates_write  ON saved_templates FOR ALL    TO authenticated
  USING (public.has_perm('design', TRUE)) WITH CHECK (public.has_perm('design', TRUE));

CREATE POLICY p_leads_select ON leads FOR SELECT TO authenticated USING (public.has_any_perm(ARRAY['leads','customers']));
CREATE POLICY p_leads_write  ON leads FOR ALL    TO authenticated USING (public.has_perm('leads', TRUE)) WITH CHECK (public.has_perm('leads', TRUE));
CREATE POLICY p_followups_select ON lead_followups FOR SELECT TO authenticated USING (public.has_any_perm(ARRAY['leads','customers']));
CREATE POLICY p_followups_write  ON lead_followups FOR ALL    TO authenticated USING (public.has_perm('leads', TRUE)) WITH CHECK (public.has_perm('leads', TRUE));
CREATE POLICY p_customers_select ON customers FOR SELECT TO authenticated USING (public.has_any_perm(ARRAY['customers','leads','events','finance']));
CREATE POLICY p_customers_write  ON customers FOR ALL    TO authenticated
  USING (public.has_any_perm(ARRAY['customers','leads'], TRUE)) WITH CHECK (public.has_any_perm(ARRAY['customers','leads'], TRUE));

CREATE POLICY p_fin_accounts ON finance_accounts FOR SELECT TO authenticated USING (public.has_perm('finance'));
CREATE POLICY p_fin_accounts_write ON finance_accounts FOR ALL TO authenticated USING (public.has_perm('finance', TRUE)) WITH CHECK (public.has_perm('finance', TRUE));
CREATE POLICY p_fin_txns ON event_transactions FOR SELECT TO authenticated USING (public.has_perm('finance') AND public.can_see_event(event_id));
CREATE POLICY p_fin_txns_write ON event_transactions FOR ALL TO authenticated
  USING (public.has_perm('finance', TRUE) AND public.can_see_event(event_id)) WITH CHECK (public.has_perm('finance', TRUE) AND public.can_see_event(event_id));

-- History stays append-only: read with History/Events, anyone active may add their own rows
CREATE POLICY p_logs_select ON event_logs FOR SELECT TO authenticated USING (public.has_any_perm(ARRAY['history','events']) AND public.can_see_event(event_id));
CREATE POLICY p_logs_insert ON event_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND user_email IS NOT DISTINCT FROM (auth.jwt() ->> 'email'));

-- Settings data: readable by every active user (the app needs it), changed with Settings (edit)
CREATE POLICY p_roles_select   ON app_roles   FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY p_roles_update   ON app_roles   FOR UPDATE TO authenticated
  USING (public.has_perm('users', TRUE) AND key <> 'superuser') WITH CHECK (public.has_perm('users', TRUE) AND key <> 'superuser');
CREATE POLICY p_modules_select ON app_modules FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY p_perms_select   ON role_permissions FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY p_perms_write    ON role_permissions FOR ALL TO authenticated
  USING (public.has_perm('users', TRUE) AND role <> 'superuser') WITH CHECK (public.has_perm('users', TRUE) AND role <> 'superuser');
CREATE POLICY p_users_select ON app_users FOR SELECT TO authenticated
  USING (email = lower(auth.jwt() ->> 'email') OR public.has_perm('users'));
CREATE POLICY p_users_write  ON app_users FOR ALL TO authenticated
  USING (public.has_perm('users', TRUE)) WITH CHECK (public.has_perm('users', TRUE));
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['app_settings','wa_templates','sender_ids','card_type_rules'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())', 'p_'||t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.has_perm(''settings'', TRUE)) WITH CHECK (public.has_perm(''settings'', TRUE))', 'p_'||t||'_write', t);
  END LOOP;
END $$;

-- Scan log: Scanner (view). Writes only through scan_card().
CREATE POLICY p_scan_logs_select ON scan_logs FOR SELECT TO authenticated USING (public.has_perm('scanner') AND public.can_see_event(event_id));

-- Event teams: visible to anyone who can see the event (and your own rows); managed with Events or Users (edit)
CREATE POLICY p_assign_select ON event_assignments FOR SELECT TO authenticated
  USING (public.can_see_event(event_id) OR email = lower(auth.jwt() ->> 'email'));
CREATE POLICY p_assign_write ON event_assignments FOR ALL TO authenticated
  USING (public.has_any_perm(ARRAY['events','users'], TRUE) AND public.can_see_event(event_id))
  WITH CHECK (public.has_any_perm(ARRAY['events','users'], TRUE) AND public.can_see_event(event_id));

-- Deleting data is for Super Admins only. A RESTRICTIVE policy is combined (AND) with the
-- permissive ones above, so every other role is refused a DELETE even if its module allows edits.
-- Not included on purpose: event_cards (re-saving a guest list removes dropped guests) and
-- event_assignments (taking someone off a team) — those are edits, not deleting records.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['events','customers','leads','lead_followups','finance_accounts','event_transactions',
                           'saved_templates','wa_templates','sender_ids','card_type_rules','app_users','app_settings','role_permissions'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.my_role() = %L)',
                   'p_' || t || '_delete_super_admin', t, 'superuser');
  END LOOP;
END $$;

-- Storage: uploads need the module that makes them
DROP POLICY IF EXISTS "authenticated_insert_templates" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_templates" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_insert_wa_cards"  ON storage.objects;
CREATE POLICY "authenticated_insert_templates" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'templates' AND public.has_perm('design', TRUE));
CREATE POLICY "authenticated_delete_templates" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'templates' AND public.my_role() = 'superuser');
CREATE POLICY "authenticated_insert_wa_cards" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wa-cards' AND public.has_any_perm(ARRAY['whatsapp','batch','design'], TRUE));

-- Grants for the new tables (anon gets nothing)
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['app_roles','app_modules','role_permissions','app_users','app_settings','wa_templates','sender_ids','card_type_rules','scan_logs','event_assignments'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.scan_logs FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. PUBLIC SCAN PAGE — no login, protected by the event's scan code.
--    Anonymous visitors get NO table access; only these functions, each of
--    which checks the code and returns the minimum needed at the door.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_code_ok(p_event UUID, p_code TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events WHERE id = p_event AND scan_code IS NOT NULL AND scan_code = p_code)
$$;
REVOKE ALL ON FUNCTION public.scan_code_ok(UUID, TEXT) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_scan_event(p_event UUID, p_code TEXT)
RETURNS TABLE (name TEXT, event_type TEXT, start_datetime TIMESTAMPTZ, cards INT, people INT, entered INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.username, e.event_type, e.start_datetime,
         (SELECT count(*)::INT FROM event_cards c WHERE c.event_id = e.id),
         (SELECT COALESCE(sum(c.max_scans),0)::INT FROM event_cards c WHERE c.event_id = e.id),
         (SELECT COALESCE(sum(c.scan_count),0)::INT FROM event_cards c WHERE c.event_id = e.id)
    FROM events e WHERE e.id = p_event AND public.scan_code_ok(p_event, p_code)
$$;

CREATE OR REPLACE FUNCTION public.public_find_cards(p_event UUID, p_code TEXT, p_query TEXT DEFAULT NULL, p_card UUID DEFAULT NULL)
RETURNS TABLE (id UUID, name TEXT, card_type TEXT, max_scans INT, scan_count INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.card_type, c.max_scans, c.scan_count
    FROM event_cards c
   WHERE c.event_id = p_event AND public.scan_code_ok(p_event, p_code)
     AND ( (p_card IS NOT NULL AND c.id = p_card)
        OR (p_card IS NULL AND length(trim(COALESCE(p_query,''))) >= 2
            AND (c.name ILIKE '%' || trim(p_query) || '%'
              OR c.card_code ILIKE '%' || trim(p_query) || '%')) )
   ORDER BY c.name LIMIT 20
$$;

CREATE OR REPLACE FUNCTION public.public_recent_scans(p_event UUID, p_code TEXT)
RETURNS TABLE (name TEXT, people INT, accepted BOOLEAN, reason TEXT, scanned_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.name, l.people, l.accepted, l.reason, l.scanned_at
    FROM scan_logs l LEFT JOIN event_cards c ON c.id = l.event_card_id
   WHERE l.event_id = p_event AND public.scan_code_ok(p_event, p_code)
   ORDER BY l.scanned_at DESC LIMIT 15
$$;

-- Door statistics for the page's Statistics view on phones: cards by size (single admits 1,
-- double 2, group more — cardKind() in src/lib/cardRules.js), cards with anyone in, cards
-- fully used, people expected / entered. Counts only, no names. No row for a wrong code.
CREATE OR REPLACE FUNCTION public.public_scan_stats(p_event UUID, p_code TEXT)
RETURNS TABLE (cards INT, single_cards INT, double_cards INT, group_cards INT, people INT, entered INT, scanned_cards INT, complete_cards INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(c.id)::INT,
         (count(c.id) FILTER (WHERE c.max_scans <= 1))::INT,
         (count(c.id) FILTER (WHERE c.max_scans = 2))::INT,
         (count(c.id) FILTER (WHERE c.max_scans > 2))::INT,
         COALESCE(sum(c.max_scans), 0)::INT,               -- max_scans is always >= 1 (sync_card_max_scans)
         COALESCE(sum(c.scan_count), 0)::INT,
         (count(c.id) FILTER (WHERE c.scan_count > 0))::INT,
         (count(c.id) FILTER (WHERE c.scan_count >= c.max_scans))::INT
    FROM events e LEFT JOIN event_cards c ON c.event_id = e.id
   WHERE e.id = p_event AND public.scan_code_ok(p_event, p_code)
   GROUP BY e.id
$$;
REVOKE ALL ON FUNCTION public.public_scan_event(UUID, TEXT), public.public_find_cards(UUID, TEXT, TEXT, UUID), public.public_recent_scans(UUID, TEXT), public.public_scan_stats(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_scan_event(UUID, TEXT), public.public_find_cards(UUID, TEXT, TEXT, UUID), public.public_recent_scans(UUID, TEXT), public.public_scan_stats(UUID, TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7. VIEW-ONLY SHARE LINK — #/view/<eventId> + events.view_code. Read-only guest
--    list (card sent, call answer + comment, check-in) and the card history.
--    Phone numbers are masked; nothing can be changed through these functions.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS view_code TEXT;   -- NULL = view-only link off

-- Turn the link on (new code) or off (NULL). Needs Events or Calls (edit) on an event you can see.
CREATE OR REPLACE FUNCTION public.set_view_code(p_event UUID, p_code TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_any_perm(ARRAY['events','calls','history'], TRUE) AND public.can_see_event(p_event)) THEN
    RAISE EXCEPTION 'Your role cannot share this event';
  END IF;
  IF p_code IS NOT NULL AND p_code !~ '^[A-Z0-9]{6,12}$' THEN RAISE EXCEPTION 'Invalid code'; END IF;
  UPDATE events SET view_code = p_code WHERE id = p_event;
END $$;
REVOKE ALL ON FUNCTION public.set_view_code(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_view_code(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.view_code_ok(p_event UUID, p_code TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events WHERE id = p_event AND view_code IS NOT NULL AND view_code = p_code)
$$;
REVOKE ALL ON FUNCTION public.view_code_ok(UUID, TEXT) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mask_phone(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(regexp_replace(p, '\D', '', 'g'), '') = '' THEN NULL
              ELSE '••• ' || right(regexp_replace(p, '\D', '', 'g'), 3) END
$$;

CREATE OR REPLACE FUNCTION public.public_view_event(p_event UUID, p_code TEXT)
RETURNS TABLE (name TEXT, event_type TEXT, start_datetime TIMESTAMPTZ, venue_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.username, e.event_type, e.start_datetime, e.venue_name
    FROM events e WHERE e.id = p_event AND public.view_code_ok(p_event, p_code)
$$;

CREATE OR REPLACE FUNCTION public.public_view_guests(p_event UUID, p_code TEXT)
RETURNS TABLE (id UUID, name TEXT, card_type TEXT, phone TEXT, wa_status TEXT, sms_status TEXT,
               call_status TEXT, call_comment TEXT, call_updated_at TIMESTAMPTZ,
               max_scans INT, scan_count INT, last_scanned_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.card_type, public.mask_phone(c.phone), c.wa_status, c.sms_status,
         c.call_status, c.call_comment, c.call_updated_at, c.max_scans, c.scan_count, c.last_scanned_at
    FROM event_cards c
   WHERE c.event_id = p_event AND public.view_code_ok(p_event, p_code)
   ORDER BY c.name
$$;

CREATE OR REPLACE FUNCTION public.public_view_history(p_event UUID, p_code TEXT)
RETURNS TABLE (created_at TIMESTAMPTZ, channel TEXT, action TEXT, status TEXT, recipient_name TEXT,
               recipient_phone TEXT, message_title TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.created_at, l.channel, l.action, l.status, l.recipient_name, public.mask_phone(l.recipient_phone),
         l.message_title, l.detail
    FROM event_logs l
   WHERE l.event_id = p_event AND public.view_code_ok(p_event, p_code)
     AND l.channel IN ('whatsapp','sms','card','calls','scan')
   ORDER BY l.created_at DESC LIMIT 1000
$$;
REVOKE ALL ON FUNCTION public.public_view_event(UUID, TEXT), public.public_view_guests(UUID, TEXT), public.public_view_history(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_view_event(UUID, TEXT), public.public_view_guests(UUID, TEXT), public.public_view_history(UUID, TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 8. STORAGE — how much each bucket holds (shown against the storage_quota_mb
--    setting) and clearing the WhatsApp card images. The WhatsApp tab shows the
--    usage; Settings → Storage manages it (clearing is Super Admin only and goes
--    through the Storage API so the files are really removed).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES ('storage_quota_mb', '1024')   -- Supabase Free plan = 1 GB
ON CONFLICT (key) DO NOTHING;

DROP FUNCTION IF EXISTS public.wa_cards_usage();
CREATE OR REPLACE FUNCTION public.storage_usage()
RETURNS TABLE (bucket TEXT, files BIGINT, bytes BIGINT, oldest TIMESTAMPTZ, newest TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  SELECT o.bucket_id, count(*), COALESCE(sum((o.metadata ->> 'size')::BIGINT), 0), min(o.created_at), max(o.created_at)
    FROM storage.objects o
   WHERE public.is_active_user()
   GROUP BY o.bucket_id
$$;

-- Names of the stored card files, oldest first (Super Admin only), for clearing in batches
CREATE OR REPLACE FUNCTION public.wa_cards_names(p_limit INT DEFAULT 1000)
RETURNS TABLE (name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  SELECT o.name FROM storage.objects o
   WHERE o.bucket_id = 'wa-cards' AND public.my_role() = 'superuser'
   ORDER BY o.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000)
$$;
REVOKE ALL ON FUNCTION public.storage_usage(), public.wa_cards_names(INT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.storage_usage(), public.wa_cards_names(INT) TO authenticated;

DROP POLICY IF EXISTS "superadmin_delete_wa_cards" ON storage.objects;
CREATE POLICY "superadmin_delete_wa_cards" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wa-cards' AND public.my_role() = 'superuser');

-- Card fonts uploaded in Settings → General (fonts that aren't on Google Fonts, e.g. Aptos):
-- public so every computer's browser can load them by URL; uploaded with Settings (edit);
-- each upload gets a new name, so nothing is overwritten. The list is app_settings.card_fonts.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fonts', 'fonts', true, 5242880,
  ARRAY['font/ttf','font/otf','font/woff','font/woff2','application/x-font-ttf','application/x-font-otf',
        'application/font-woff','application/font-woff2','application/vnd.ms-opentype','application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "settings_insert_fonts" ON storage.objects;
CREATE POLICY "settings_insert_fonts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fonts' AND public.has_perm('settings', TRUE));
DROP POLICY IF EXISTS "superadmin_delete_fonts" ON storage.objects;
CREATE POLICY "superadmin_delete_fonts" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fonts' AND public.my_role() = 'superuser');

-- ─────────────────────────────────────────────────────────────────────
-- 9. MESSAGE SCHEDULES — SMS / WhatsApp sends planned ahead: one or more
--    dates, or chosen weekdays repeated for a number of weeks. The browser
--    works out every send time and saves them as runs; pg_cron calls the
--    run-schedules Edge Function every minute while a run is due, and it
--    sends with the service role. Users never write these tables directly:
--    save_message_schedule() / set_message_schedule_status() check the role,
--    the event and that no send time has already passed.
-- ─────────────────────────────────────────────────────────────────────

-- Each guest's uploaded WhatsApp card image, so a scheduled send can attach it
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS card_url TEXT;

CREATE TABLE IF NOT EXISTS message_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('sms','whatsapp')),
  title        TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body         TEXT,                                 -- SMS text: {name} {cardType} {phone}
  message_key  TEXT NOT NULL DEFAULT 'custom',       -- 'main' (guest statuses update like a normal send) | an extra message id | 'custom'
  sender_id    TEXT,                                 -- SMS sender ID
  wa_template  TEXT,
  wa_account   TEXT,
  wa_image     BOOLEAN NOT NULL DEFAULT TRUE,        -- template has an image header → sends each guest's card
  audience     TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','not_sent','confirmed','not_declined')),
  pattern      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- the form (dates / weekdays …), to describe and edit it
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','cancelled')),
  total_runs   INT NOT NULL DEFAULT 0,
  done_runs    INT NOT NULL DEFAULT 0,
  created_by   TEXT DEFAULT (auth.jwt() ->> 'email'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_schedules_event ON message_schedules(event_id);

CREATE TABLE IF NOT EXISTS message_schedule_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  UUID NOT NULL REFERENCES message_schedules(id) ON DELETE CASCADE,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  run_at       TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','done','failed','skipped','cancelled','handed')),
  sent         INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  skipped      INT NOT NULL DEFAULT 0,
  detail       TEXT,
  next_index   INT NOT NULL DEFAULT 0,               -- how far through its recipients the run is
  locked_until TIMESTAMPTZ,                          -- lease: a run being sent is not picked up twice
  attempts     INT NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON message_schedule_runs(schedule_id, run_at);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_due ON message_schedule_runs(run_at) WHERE status IN ('pending','sending');

-- Who sends a schedule's SMS: our server (run-schedules, at each time) or NextSMS itself —
-- handed over from the app when the schedule is saved (the normal send with a date and time).
-- NextSMS has no way to cancel those, so such a schedule can't be paused, cancelled or edited.
-- A handed-over send time is 'handed' until its time passes, then 'done' (finish_handed_runs).
ALTER TABLE message_schedules ADD COLUMN IF NOT EXISTS sent_by TEXT NOT NULL DEFAULT 'server';
DO $$ BEGIN
  ALTER TABLE message_schedules ADD CONSTRAINT message_schedules_sent_by_check CHECK (sent_by IN ('server','nextsms'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE message_schedule_runs DROP CONSTRAINT IF EXISTS message_schedule_runs_status_check;
ALTER TABLE message_schedule_runs ADD CONSTRAINT message_schedule_runs_status_check
  CHECK (status IN ('pending','sending','done','failed','skipped','cancelled','handed'));

-- Who a run goes to, fixed when it starts (phones + texts). Server only; removed when the run ends.
CREATE TABLE IF NOT EXISTS message_run_targets (
  run_id     UUID PRIMARY KEY REFERENCES message_schedule_runs(id) ON DELETE CASCADE,
  targets    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE message_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_schedule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_run_targets   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_schedules, public.message_schedule_runs, public.message_run_targets FROM anon, authenticated;
GRANT SELECT, DELETE ON public.message_schedules TO authenticated;
GRANT SELECT ON public.message_schedule_runs TO authenticated;
GRANT ALL ON public.message_schedules, public.message_schedule_runs, public.message_run_targets TO service_role;

-- Seen by whoever may view that channel (SMS / WhatsApp) on an event they can see.
-- Deleting a schedule is Super Admin only; everyone else cancels it.
DROP POLICY IF EXISTS p_schedules_select ON message_schedules;
DROP POLICY IF EXISTS p_schedules_delete ON message_schedules;
DROP POLICY IF EXISTS p_schedule_runs_select ON message_schedule_runs;
CREATE POLICY p_schedules_select ON message_schedules FOR SELECT TO authenticated
  USING (public.has_perm(channel, FALSE) AND public.can_see_event(event_id));
CREATE POLICY p_schedules_delete ON message_schedules FOR DELETE TO authenticated
  USING (public.my_role() = 'superuser');
CREATE POLICY p_schedule_runs_select ON message_schedule_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM message_schedules s WHERE s.id = message_schedule_runs.schedule_id));

-- Recounts a schedule's runs and marks it done once nothing is left to send (a send held by
-- NextSMS still counts as to come)
CREATE OR REPLACE FUNCTION public.refresh_message_schedule(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE message_schedules s SET
    total_runs = (SELECT count(*) FROM message_schedule_runs r WHERE r.schedule_id = s.id AND r.status <> 'cancelled'),
    done_runs  = (SELECT count(*) FROM message_schedule_runs r WHERE r.schedule_id = s.id AND r.status IN ('done','failed','skipped')),
    status     = CASE WHEN s.status IN ('active','paused')
                       AND NOT EXISTS (SELECT 1 FROM message_schedule_runs r WHERE r.schedule_id = s.id AND r.status IN ('pending','sending','handed'))
                      THEN 'done' ELSE s.status END
   WHERE s.id = p_id
$$;

-- The server's clock. The schedule form checks send times against it (and warns when the
-- device's clock is off), because save_message_schedule refuses times that have passed by
-- this clock and run-schedules sends by it — a phone's clock can be minutes or hours off.
CREATE OR REPLACE FUNCTION public.server_time() RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT now() $$;
REVOKE ALL ON FUNCTION public.server_time() FROM public;
GRANT EXECUTE ON FUNCTION public.server_time() TO authenticated;

-- Creates a schedule with its send times, or (p_id set) edits one: the fields change and
-- the sends still waiting are replaced by p_run_times; sends already made stay as they were.
-- p_fields: title, body, message_key, sender_id, wa_template, wa_account, wa_image, audience, pattern,
-- sent_by ('server' | 'nextsms' — SMS only, fixed when created; a NextSMS schedule can't be edited).
CREATE OR REPLACE FUNCTION public.save_message_schedule(
  p_id UUID, p_event_id UUID, p_channel TEXT, p_fields JSONB, p_run_times TIMESTAMPTZ[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id     UUID := p_id;
  v_old    message_schedules%ROWTYPE;
  v_times  TIMESTAMPTZ[];
  v_email  TEXT := auth.jwt() ->> 'email';
  v_title  TEXT := left(trim(COALESCE(p_fields ->> 'title', '')), 120);
  v_body   TEXT := NULLIF(p_fields ->> 'body', '');
  v_key    TEXT := left(COALESCE(NULLIF(trim(p_fields ->> 'message_key'), ''), 'custom'), 64);
  v_sender TEXT := NULLIF(trim(COALESCE(p_fields ->> 'sender_id', '')), '');
  v_tpl    TEXT := NULLIF(trim(COALESCE(p_fields ->> 'wa_template', '')), '');
  v_acct   TEXT := NULLIF(trim(COALESCE(p_fields ->> 'wa_account', '')), '');
  v_image  BOOLEAN := p_channel = 'whatsapp' AND COALESCE((p_fields ->> 'wa_image')::BOOLEAN, TRUE);   -- SMS never has an image
  v_aud    TEXT := COALESCE(NULLIF(p_fields ->> 'audience', ''), 'all');
  v_pat    JSONB := COALESCE(p_fields -> 'pattern', '{}'::jsonb);
  v_by     TEXT := CASE WHEN p_channel = 'sms' AND p_fields ->> 'sent_by' = 'nextsms' THEN 'nextsms' ELSE 'server' END;
BEGIN
  IF p_channel NOT IN ('sms','whatsapp') THEN RAISE EXCEPTION 'Unknown channel %', p_channel; END IF;
  IF NOT public.has_perm(p_channel, TRUE) THEN
    RAISE EXCEPTION 'Your role cannot schedule % sends', CASE p_channel WHEN 'sms' THEN 'SMS' ELSE 'WhatsApp' END;
  END IF;
  IF p_event_id IS NULL OR NOT public.can_see_event(p_event_id) THEN RAISE EXCEPTION 'You are not assigned to this event'; END IF;
  IF v_title = '' THEN RAISE EXCEPTION 'Give the schedule a name'; END IF;
  IF p_channel = 'sms' AND COALESCE(trim(v_body), '') = '' THEN RAISE EXCEPTION 'The SMS text is empty'; END IF;
  IF p_channel = 'sms' AND v_sender IS NOT NULL AND v_sender !~ '^[A-Za-z0-9 ]{1,11}$' THEN RAISE EXCEPTION 'Sender ID "%" is not valid', v_sender; END IF;
  IF p_channel = 'whatsapp' AND v_tpl IS NULL THEN RAISE EXCEPTION 'Pick a WhatsApp template'; END IF;
  IF v_aud NOT IN ('all','not_sent','confirmed','not_declined') THEN RAISE EXCEPTION 'Unknown audience %', v_aud; END IF;
  IF v_aud = 'not_sent' AND NOT ((p_channel = 'sms' AND v_key = 'main') OR (p_channel = 'whatsapp' AND v_image)) THEN
    RAISE EXCEPTION '"Not sent yet" works only for the main SMS or the WhatsApp card';
  END IF;

  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_times FROM unnest(p_run_times) t WHERE t IS NOT NULL;
  IF v_times IS NULL OR cardinality(v_times) = 0 THEN RAISE EXCEPTION 'Pick at least one send time'; END IF;
  IF cardinality(v_times) <> cardinality(p_run_times) THEN RAISE EXCEPTION 'The same send time is listed twice'; END IF;
  IF cardinality(v_times) > 100 THEN RAISE EXCEPTION 'At most 100 sends per schedule'; END IF;
  IF v_times[1] < NOW() + INTERVAL '30 seconds' THEN RAISE EXCEPTION 'A send time has already passed — pick a later time'; END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM message_schedules s WHERE s.id = v_id FOR UPDATE;
    IF NOT FOUND OR v_old.event_id <> p_event_id OR v_old.channel <> p_channel THEN RAISE EXCEPTION 'Schedule not found'; END IF;
    IF v_old.status IN ('done','cancelled') THEN RAISE EXCEPTION 'This schedule has finished — create a new one'; END IF;
    IF v_old.sent_by = 'nextsms' THEN RAISE EXCEPTION 'This schedule was handed to NextSMS and can''t be changed'; END IF;
    UPDATE message_schedules s SET title = v_title, body = v_body, message_key = v_key, sender_id = v_sender,
           wa_template = v_tpl, wa_account = v_acct, wa_image = v_image, audience = v_aud, pattern = v_pat,
           updated_by = v_email, updated_at = NOW()
     WHERE s.id = v_id;
    UPDATE message_schedule_runs r SET status = 'cancelled', finished_at = NOW(), detail = 'Replaced when the schedule was edited'
     WHERE r.schedule_id = v_id AND r.status = 'pending';
  ELSE
    INSERT INTO message_schedules (event_id, channel, title, body, message_key, sender_id, wa_template, wa_account, wa_image, audience, pattern, created_by, sent_by)
    VALUES (p_event_id, p_channel, v_title, v_body, v_key, v_sender, v_tpl, v_acct, v_image, v_aud, v_pat, v_email, v_by)
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO message_schedule_runs (schedule_id, event_id, run_at) SELECT v_id, p_event_id, t FROM unnest(v_times) t;
  PERFORM public.refresh_message_schedule(v_id);
  RETURN v_id;
END $$;

-- Pause, resume or cancel a schedule. Resuming skips the sends that came due while it was
-- paused (a late reminder is worse than none); cancelling stops the waiting sends and a send
-- in progress (the function checks before every batch).
CREATE OR REPLACE FUNCTION public.set_message_schedule_status(p_id UUID, p_status TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v message_schedules%ROWTYPE;
BEGIN
  SELECT * INTO v FROM message_schedules s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_see_event(v.event_id) THEN RAISE EXCEPTION 'Schedule not found'; END IF;
  IF NOT public.has_perm(v.channel, TRUE) THEN RAISE EXCEPTION 'Your role cannot change this schedule'; END IF;
  IF v.status IN ('done','cancelled') THEN RAISE EXCEPTION 'This schedule has already finished'; END IF;
  -- NextSMS can't stop SMS it holds: such a schedule can't be paused, and can be cancelled
  -- only when none of its sends is still waiting there (e.g. the hand-over failed)
  IF v.sent_by = 'nextsms' AND p_status IN ('paused','active') THEN
    RAISE EXCEPTION 'SMS handed to NextSMS can''t be paused — NextSMS has no way to hold them back';
  END IF;
  IF v.sent_by = 'nextsms' AND p_status = 'cancelled'
     AND EXISTS (SELECT 1 FROM message_schedule_runs r WHERE r.schedule_id = p_id AND r.status = 'handed' AND r.run_at > NOW()) THEN
    RAISE EXCEPTION 'SMS handed to NextSMS can''t be cancelled — NextSMS has no way to stop them';
  END IF;
  IF p_status = 'paused' THEN
    UPDATE message_schedules s SET status = 'paused' WHERE s.id = p_id;
  ELSIF p_status = 'active' THEN
    UPDATE message_schedule_runs r SET status = 'skipped', finished_at = NOW(), detail = 'Missed while the schedule was paused'
     WHERE r.schedule_id = p_id AND r.status = 'pending' AND r.run_at <= NOW();
    UPDATE message_schedules s SET status = 'active' WHERE s.id = p_id;
    PERFORM public.refresh_message_schedule(p_id);
  ELSIF p_status = 'cancelled' THEN
    UPDATE message_schedule_runs r SET status = 'cancelled', finished_at = NOW(), locked_until = NULL,
           detail = CASE WHEN r.status = 'sending' THEN 'Stopped when the schedule was cancelled' ELSE 'Schedule cancelled' END
     WHERE r.schedule_id = p_id AND r.status IN ('pending','sending');
    UPDATE message_schedules s SET status = 'cancelled' WHERE s.id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown status %', p_status;
  END IF;
  UPDATE message_schedules s SET updated_by = auth.jwt() ->> 'email', updated_at = NOW() WHERE s.id = p_id;
  RETURN (SELECT s.status FROM message_schedules s WHERE s.id = p_id);
END $$;

-- The app reports one send time of a NextSMS schedule after handing it over: 'handed' when
-- NextSMS took some of it (it holds them until the time), 'failed' when it took none (nothing
-- will go out). Only a send time still waiting, of a NextSMS SMS schedule on an event you can
-- see, with SMS (edit).
CREATE OR REPLACE FUNCTION public.record_schedule_handover(
  p_run_id UUID, p_accepted BOOLEAN, p_sent INT, p_failed INT, p_skipped INT, p_detail TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sched UUID;
BEGIN
  SELECT r.schedule_id INTO v_sched
    FROM message_schedule_runs r JOIN message_schedules s ON s.id = r.schedule_id
   WHERE r.id = p_run_id AND r.status = 'pending' AND s.sent_by = 'nextsms' AND s.channel = 'sms'
     AND public.has_perm('sms', TRUE) AND public.can_see_event(s.event_id)
   FOR UPDATE OF r;
  IF v_sched IS NULL THEN RETURN FALSE; END IF;
  UPDATE message_schedule_runs r SET
         status = CASE WHEN p_accepted THEN 'handed' ELSE 'failed' END,
         sent = GREATEST(COALESCE(p_sent, 0), 0), failed = GREATEST(COALESCE(p_failed, 0), 0),
         skipped = GREATEST(COALESCE(p_skipped, 0), 0), detail = left(p_detail, 500),
         started_at = NOW(), finished_at = CASE WHEN p_accepted THEN NULL ELSE NOW() END, attempts = r.attempts + 1
   WHERE r.id = p_run_id;
  PERFORM public.refresh_message_schedule(v_sched);
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.record_schedule_handover(UUID, BOOLEAN, INT, INT, INT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_schedule_handover(UUID, BOOLEAN, INT, INT, INT, TEXT) TO authenticated;

-- Once a handed-over send time has passed, NextSMS has sent it: mark it done (each message's
-- own result still comes from the delivery reports). A NextSMS send time never handed over
-- (the page closed first) is skipped — nothing went out. Called every minute by pg_cron.
CREATE OR REPLACE FUNCTION public.finish_handed_runs() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids UUID[];
  v_n   INT;
BEGIN
  WITH u AS (
    UPDATE message_schedule_runs r SET
           status = CASE WHEN r.status = 'handed' THEN 'done' ELSE 'skipped' END,
           finished_at = NOW(),
           detail = CASE WHEN r.status = 'handed' THEN left(COALESCE(r.detail || ' · ', '') || 'sent by NextSMS at its time', 500)
                         ELSE 'Not handed to NextSMS — the page was closed before it finished, so nothing went out' END
      FROM message_schedules s
     WHERE s.id = r.schedule_id AND s.sent_by = 'nextsms' AND r.run_at <= NOW()
       AND (r.status = 'handed' OR (r.status = 'pending' AND r.run_at <= NOW() - INTERVAL '10 minutes'))
    RETURNING r.schedule_id
  ) SELECT array_agg(DISTINCT u.schedule_id), count(*) INTO v_ids, v_n FROM u;
  PERFORM public.refresh_message_schedule(x) FROM unnest(COALESCE(v_ids, '{}')) x;
  RETURN COALESCE(v_n, 0);
END $$;
REVOKE ALL ON FUNCTION public.finish_handed_runs() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_handed_runs() TO service_role;

-- ── Used only by the run-schedules Edge Function (service role) ──

-- Picks the next due run and leases it for 2 minutes, so two calls never send the same run.
-- Runs more than 2 hours late are skipped (the server was not running at the time), and a run
-- still "sending" after 6 hours is given up.
CREATE OR REPLACE FUNCTION public.claim_schedule_run()
RETURNS TABLE (run_id UUID, schedule_id UUID, event_id UUID, run_at TIMESTAMPTZ, next_index INT,
               sent INT, failed INT, skipped INT, run_number INT, total_runs INT, has_targets BOOLEAN,
               channel TEXT, title TEXT, body TEXT, message_key TEXT, sender_id TEXT, wa_template TEXT,
               wa_account TEXT, wa_image BOOLEAN, audience TEXT, created_by TEXT, event_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run UUID;
  v_ids UUID[];
BEGIN
  WITH u AS (
    UPDATE message_schedule_runs r SET status = 'skipped', finished_at = NOW(),
           detail = 'Missed — the server was not running at this time'
      FROM message_schedules s
     WHERE s.id = r.schedule_id AND s.status = 'active' AND s.sent_by = 'server' AND r.status = 'pending' AND r.run_at < NOW() - INTERVAL '2 hours'
    RETURNING r.schedule_id
  ) SELECT array_agg(DISTINCT u.schedule_id) INTO v_ids FROM u;
  PERFORM public.refresh_message_schedule(x) FROM unnest(COALESCE(v_ids, '{}')) x;

  WITH u AS (
    UPDATE message_schedule_runs r SET status = 'failed', finished_at = NOW(), locked_until = NULL,
           detail = 'Stopped: sending did not finish within 6 hours'
     WHERE r.status = 'sending' AND r.started_at < NOW() - INTERVAL '6 hours'
    RETURNING r.schedule_id
  ) SELECT array_agg(DISTINCT u.schedule_id) INTO v_ids FROM u;
  PERFORM public.refresh_message_schedule(x) FROM unnest(COALESCE(v_ids, '{}')) x;

  SELECT r.id INTO v_run
    FROM message_schedule_runs r JOIN message_schedules s ON s.id = r.schedule_id
   WHERE s.status = 'active' AND s.sent_by = 'server'                -- NextSMS sends its own (never twice)
     AND ((r.status = 'pending' AND r.run_at <= NOW())
       OR (r.status = 'sending' AND (r.locked_until IS NULL OR r.locked_until < NOW())))
   ORDER BY r.run_at
   LIMIT 1
   FOR UPDATE OF r SKIP LOCKED;
  IF v_run IS NULL THEN RETURN; END IF;

  UPDATE message_schedule_runs r SET status = 'sending', started_at = COALESCE(r.started_at, NOW()),
         locked_until = NOW() + INTERVAL '2 minutes', attempts = r.attempts + 1
   WHERE r.id = v_run;

  RETURN QUERY
  SELECT r.id, r.schedule_id, r.event_id, r.run_at, r.next_index, r.sent, r.failed, r.skipped,
         (SELECT count(*)::INT FROM message_schedule_runs x WHERE x.schedule_id = r.schedule_id AND x.status <> 'cancelled' AND x.run_at <= r.run_at),
         s.total_runs, EXISTS (SELECT 1 FROM message_run_targets t WHERE t.run_id = r.id),
         s.channel, s.title, s.body, s.message_key, s.sender_id, s.wa_template, s.wa_account, s.wa_image, s.audience, s.created_by,
         e.username
    FROM message_schedule_runs r
    JOIN message_schedules s ON s.id = r.schedule_id
    JOIN events e ON e.id = r.event_id
   WHERE r.id = v_run;
END $$;

-- Saves how far a run has got and renews (or, p_release, hands back) its lease.
-- Returns FALSE when the run must stop now: cancelled, or its schedule paused.
CREATE OR REPLACE FUNCTION public.save_run_progress(
  p_run_id UUID, p_next_index INT, p_sent INT, p_failed INT, p_skipped INT, p_release BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_active BOOLEAN;
BEGIN
  SELECT s.status = 'active' INTO v_active
    FROM message_schedule_runs r JOIN message_schedules s ON s.id = r.schedule_id
   WHERE r.id = p_run_id AND r.status = 'sending';
  IF v_active IS NULL THEN RETURN FALSE; END IF;
  UPDATE message_schedule_runs r SET next_index = GREATEST(COALESCE(p_next_index, 0), 0),
         sent = GREATEST(COALESCE(p_sent, 0), 0), failed = GREATEST(COALESCE(p_failed, 0), 0), skipped = GREATEST(COALESCE(p_skipped, 0), 0),
         locked_until = CASE WHEN p_release OR NOT v_active THEN NULL ELSE NOW() + INTERVAL '2 minutes' END
   WHERE r.id = p_run_id AND r.status = 'sending';
  RETURN v_active;
END $$;

-- Ends a run (done / failed), drops its recipient list and updates the schedule's counts
CREATE OR REPLACE FUNCTION public.finish_schedule_run(p_run_id UUID, p_status TEXT, p_detail TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sched UUID;
BEGIN
  IF p_status NOT IN ('done','failed') THEN RAISE EXCEPTION 'Unknown status %', p_status; END IF;
  UPDATE message_schedule_runs r SET status = p_status, finished_at = NOW(), locked_until = NULL, detail = left(p_detail, 500)
   WHERE r.id = p_run_id AND r.status = 'sending'
  RETURNING r.schedule_id INTO v_sched;
  DELETE FROM message_run_targets t WHERE t.run_id = p_run_id;
  IF v_sched IS NULL THEN RETURN FALSE; END IF;
  PERFORM public.refresh_message_schedule(v_sched);
  RETURN TRUE;
END $$;

-- Main-SMS and card sends update the guests' statuses like a send from the app does.
-- p_items: [{ "id": card id, "sms_status": … } or { "id": …, "wa_status": … }]
CREATE OR REPLACE FUNCTION public.set_card_send_statuses(p_items JSONB) RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH x AS (
    SELECT (i ->> 'id')::UUID AS id, i ->> 'sms_status' AS sms, i ->> 'wa_status' AS wa
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
     WHERE i ? 'id'
  ), u AS (
    UPDATE event_cards c SET sms_status = COALESCE(x.sms, c.sms_status), wa_status = COALESCE(x.wa, c.wa_status)
      FROM x WHERE c.id = x.id
    RETURNING 1
  ) SELECT count(*)::INT FROM u
$$;

REVOKE ALL ON FUNCTION public.refresh_message_schedule(UUID), public.claim_schedule_run(),
  public.save_run_progress(UUID, INT, INT, INT, INT, BOOLEAN), public.finish_schedule_run(UUID, TEXT, TEXT),
  public.set_card_send_statuses(JSONB) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_message_schedule(UUID), public.claim_schedule_run(),
  public.save_run_progress(UUID, INT, INT, INT, INT, BOOLEAN), public.finish_schedule_run(UUID, TEXT, TEXT),
  public.set_card_send_statuses(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.save_message_schedule(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ[]),
  public.set_message_schedule_status(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_message_schedule(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ[]),
  public.set_message_schedule_status(UUID, TEXT) TO authenticated;

-- Every minute, but only while a send is due, call the run-schedules Edge Function. The
-- project URL and the shared secret come from Supabase Vault (created once by hand — README
-- "Scheduled sends"), so neither is in this file. Where pg_cron / pg_net aren't available
-- this only prints a notice and the schedules wait.
DO $outer$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  PERFORM cron.schedule('nikadi-run-schedules', '* * * * *', $job$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nikadi_project_url') || '/functions/v1/run-schedules',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nikadi_cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000)
    WHERE EXISTS (
      SELECT 1 FROM public.message_schedule_runs r JOIN public.message_schedules s ON s.id = r.schedule_id
       WHERE s.status = 'active' AND s.sent_by = 'server'
         AND ((r.status = 'pending' AND r.run_at <= NOW())
           OR (r.status = 'sending' AND (r.locked_until IS NULL OR r.locked_until < NOW()))))
  $job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Scheduled sends: could not set up pg_cron / pg_net (%). Turn both on under Database → Extensions, then run this file again.', SQLERRM;
END $outer$;

-- Every minute: mark NextSMS send times whose time has passed as done (plain SQL — no Edge
-- Function or Vault secret needed)
DO $outer$
BEGIN
  PERFORM cron.schedule('nikadi-finish-handed', '* * * * *', $job$ SELECT public.finish_handed_runs() $job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'NextSMS schedules: could not set up pg_cron (%). Turn on pg_cron under Database → Extensions, then run this file again.', SQLERRM;
END $outer$;

-- Live progress of schedules in the SMS / WhatsApp tabs
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE message_schedules;     EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE message_schedule_runs; EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 10. FEEDBACK — what users tell the team about the system: problems,
--     ideas, questions, praise. Every active user can send feedback, see
--     their own with the team's reply, and edit it until the team has
--     looked at it. The Feedback module (view / edit) sees and answers all
--     of it. Deleting is Super Admin only.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO app_modules (key, label, sort) VALUES ('feedback', 'Feedback', 16)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, sort = EXCLUDED.sort;
INSERT INTO role_permissions (role, module, can_view, can_edit)
SELECT r, m, TRUE, (p = 'E') FROM (VALUES ('admin','feedback','E')) AS t(r, m, p)
ON CONFLICT (role, module) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('problem','idea','question','praise')),
  rating      INT CHECK (rating BETWEEN 1 AND 5),                -- optional 1–5 stars
  message     TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 3 AND 4000),
  page        TEXT,                                              -- the tab the user was on
  event_id    UUID REFERENCES events(id) ON DELETE SET NULL,      -- the event that was open, if any
  device      TEXT,                                              -- e.g. "Chrome · Android · 412×915"
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','planned','done','wont_fix')),
  reply       TEXT CHECK (reply IS NULL OR length(reply) <= 4000),
  replied_by  TEXT,
  replied_at  TIMESTAMPTZ,
  created_by  TEXT NOT NULL DEFAULT lower(auth.jwt() ->> 'email'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON app_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_author  ON app_feedback(created_by);

-- Who sent it and when can't be faked or changed. A new row always starts as "new" with no
-- reply. The team (Feedback edit) sets the status and reply (reply author and time follow
-- the text); the sender may only change kind / rating / message, and only while it's "new".
CREATE OR REPLACE FUNCTION public.guard_app_feedback() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me TEXT := lower(auth.jwt() ->> 'email');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF me IS NOT NULL THEN NEW.created_by := me; END IF;
    NEW.status := 'new'; NEW.reply := NULL; NEW.replied_by := NULL; NEW.replied_at := NULL;
    NEW.created_at := NOW(); NEW.updated_at := NOW(); NEW.updated_by := NULL;
    RETURN NEW;
  END IF;
  NEW.id := OLD.id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
  NEW.page := OLD.page; NEW.event_id := OLD.event_id; NEW.device := OLD.device;
  IF me IS NULL OR public.has_perm('feedback', TRUE) THEN
    IF NEW.reply IS DISTINCT FROM OLD.reply THEN
      NEW.reply := NULLIF(trim(NEW.reply), '');
      NEW.replied_by := CASE WHEN NEW.reply IS NULL THEN NULL ELSE me END;
      NEW.replied_at := CASE WHEN NEW.reply IS NULL THEN NULL ELSE NOW() END;
    ELSE
      NEW.replied_by := OLD.replied_by; NEW.replied_at := OLD.replied_at;
    END IF;
  ELSE
    IF OLD.status <> 'new' THEN RAISE EXCEPTION 'The team has already seen this feedback, so it can no longer be changed'; END IF;
    NEW.status := OLD.status; NEW.reply := OLD.reply; NEW.replied_by := OLD.replied_by; NEW.replied_at := OLD.replied_at;
  END IF;
  NEW.updated_at := NOW(); NEW.updated_by := me;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_app_feedback ON app_feedback;
CREATE TRIGGER trg_guard_app_feedback BEFORE INSERT OR UPDATE ON app_feedback
  FOR EACH ROW EXECUTE FUNCTION public.guard_app_feedback();

ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_feedback FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_feedback TO authenticated;
GRANT ALL ON public.app_feedback TO service_role;
DROP POLICY IF EXISTS p_feedback_select ON app_feedback;
DROP POLICY IF EXISTS p_feedback_insert ON app_feedback;
DROP POLICY IF EXISTS p_feedback_update ON app_feedback;
DROP POLICY IF EXISTS p_feedback_delete ON app_feedback;
CREATE POLICY p_feedback_select ON app_feedback FOR SELECT TO authenticated
  USING (public.has_perm('feedback') OR (public.is_active_user() AND created_by = lower(auth.jwt() ->> 'email')));
CREATE POLICY p_feedback_insert ON app_feedback FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND created_by = lower(auth.jwt() ->> 'email'));
CREATE POLICY p_feedback_update ON app_feedback FOR UPDATE TO authenticated
  USING (public.has_perm('feedback', TRUE) OR (public.is_active_user() AND created_by = lower(auth.jwt() ->> 'email') AND status = 'new'))
  WITH CHECK (public.has_perm('feedback', TRUE) OR created_by = lower(auth.jwt() ->> 'email'));
CREATE POLICY p_feedback_delete ON app_feedback FOR DELETE TO authenticated
  USING (public.my_role() = 'superuser');

-- ─────────────────────────────────────────────────────────────────────
-- 11. DELIVERY REPORTS — what really happened to every SMS / WhatsApp sent.
--     Each send is stored with the provider's messageId. The final result
--     arrives from the delivery webhook (delivery-webhook function), from a
--     check every few minutes (run-schedules, task "deliveries") or from
--     "Check delivery now" in the app. Results only move forwards (sent →
--     delivered → read, or sent → failed) and update the guest's own status
--     for the main SMS / the WhatsApp card.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      TEXT UNIQUE,                       -- the provider's messageId (NULL when refused at send)
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_card_id   UUID REFERENCES event_cards(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','whatsapp')),
  message_key     TEXT NOT NULL DEFAULT 'custom',    -- 'main' | an extra message id | 'custom' | 'card' | 'text'
  message_title   TEXT,
  recipient_name  TEXT,
  phone           TEXT,
  schedule_run_id UUID REFERENCES message_schedule_runs(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read','failed')),
  status_id       INT,                               -- the provider's status id (NextSMS "Statuses")
  status_group    INT,
  status_name     TEXT,
  reason          TEXT,                              -- why it failed, in words
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at         TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT NOT NULL DEFAULT 'send' CHECK (source IN ('send','callback','check')),
  reply_text      TEXT,                              -- a WhatsApp button reply
  replied_at      TIMESTAMPTZ,
  checked_at      TIMESTAMPTZ,                       -- last time its report was looked up
  checks          INT NOT NULL DEFAULT 0,
  created_by      TEXT DEFAULT (auth.jwt() ->> 'email')
);
CREATE INDEX IF NOT EXISTS idx_deliveries_event   ON message_deliveries(event_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_card    ON message_deliveries(event_card_id, channel, message_key, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON message_deliveries(sent_at) WHERE status = 'sent';

-- When a new spreadsheet last reset the guest's WhatsApp / SMS statuses (written by the app's
-- Save Cards after an upload in Design). Reports of sends made before it no longer change the guest.
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS status_reset_at TIMESTAMPTZ;
-- FALSE for a guest left off a newer spreadsheet but kept for their call / check-in history:
-- still in Calls, Scanner and History, but not in the Design list, Send All, Download All or
-- scheduled sends. Back to TRUE when a later sheet has them again.
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS in_list BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE message_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_deliveries FROM anon, authenticated;
GRANT SELECT ON public.message_deliveries TO authenticated;
GRANT ALL ON public.message_deliveries TO service_role;
DROP POLICY IF EXISTS p_deliveries_select ON message_deliveries;
CREATE POLICY p_deliveries_select ON message_deliveries FOR SELECT TO authenticated
  USING (public.has_perm(channel, FALSE) AND public.can_see_event(event_id));

-- A provider status id → sent / delivered / read / failed (NULL = can't tell). Mirrors
-- PROVIDER_STATUS in supabase/functions/_shared/messaging.js — a test compares them, so keep
-- one WHEN per line.
CREATE OR REPLACE FUNCTION public.delivery_state(p_id INT, p_group INT DEFAULT NULL) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_id IN (50,51,52,77,88,109) THEN 'sent'
    WHEN p_id IN (73) THEN 'delivered'
    WHEN p_id IN (108) THEN 'read'
    WHEN p_id IN (53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,74,75,76,78,79,80,107,110,111,112,114,120) THEN 'failed'
    WHEN p_group = 18 THEN 'sent'
    WHEN p_group IN (19,22) THEN 'failed'
    ELSE NULL END
$$;

-- Records sends as they happen (the app and scheduled sends). One item per number:
--   { event_id, event_card_id?, channel, message_key, message_title, recipient_name, phone,
--     message_id?, status?, status_id?, status_group?, status_name?, reason?, card_status?,
--     update_card?, schedule_run_id?, created_by?, sent_at? }
-- sent_at: when it goes out — a later time for SMS handed to NextSMS to send then (never earlier than now)
-- For the main SMS (message_key 'main') and the WhatsApp card ('card') it also sets the guest's
-- sms_status / wa_status, so the database — not a browser's memory — holds the status
-- (update_card: false skips that, e.g. when the provider gave no answer at all).
CREATE OR REPLACE FUNCTION public.record_message_sends(p_items JSONB) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it        JSONB;
  v_n       INT := 0;
  v_event   UUID;
  v_card    UUID;
  v_channel TEXT;
  v_key     TEXT;
  v_state   TEXT;
  v_wa      TEXT;
  v_service BOOLEAN := COALESCE(auth.role(), '') = 'service_role';
  v_email   TEXT := auth.jwt() ->> 'email';
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_event   := NULLIF(it ->> 'event_id', '')::UUID;
    v_channel := it ->> 'channel';
    v_card    := NULLIF(it ->> 'event_card_id', '')::UUID;
    v_key     := left(COALESCE(NULLIF(it ->> 'message_key', ''), 'custom'), 64);
    IF v_event IS NULL OR v_channel IS NULL OR v_channel NOT IN ('sms','whatsapp') THEN RAISE EXCEPTION 'Not a valid send record'; END IF;
    IF NOT v_service AND NOT (public.has_perm(v_channel, TRUE) AND public.can_see_event(v_event)) THEN
      RAISE EXCEPTION 'Your role cannot record % sends for this event', CASE v_channel WHEN 'sms' THEN 'SMS' ELSE 'WhatsApp' END;
    END IF;
    IF v_card IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_cards c WHERE c.id = v_card AND c.event_id = v_event) THEN v_card := NULL; END IF;
    v_state := COALESCE(NULLIF(it ->> 'status', ''), public.delivery_state(NULLIF(it ->> 'status_id', '')::INT, NULLIF(it ->> 'status_group', '')::INT), 'failed');
    IF v_state NOT IN ('sent','delivered','read','failed') THEN v_state := 'failed'; END IF;

    INSERT INTO message_deliveries (message_id, event_id, event_card_id, channel, message_key, message_title, recipient_name, phone,
                                    schedule_run_id, status, status_id, status_group, status_name, reason, done_at, source, created_by, sent_at)
    VALUES (NULLIF(it ->> 'message_id', ''), v_event, v_card, v_channel, v_key, left(it ->> 'message_title', 120), left(it ->> 'recipient_name', 200),
            left(it ->> 'phone', 20), NULLIF(it ->> 'schedule_run_id', '')::UUID, v_state, NULLIF(it ->> 'status_id', '')::INT,
            NULLIF(it ->> 'status_group', '')::INT, left(it ->> 'status_name', 80), left(it ->> 'reason', 300),
            CASE WHEN v_state IN ('delivered','read','failed') THEN NOW() END, 'send',
            COALESCE(NULLIF(it ->> 'created_by', ''), v_email),
            GREATEST(COALESCE(NULLIF(it ->> 'sent_at', '')::TIMESTAMPTZ, NOW()), NOW()))
    ON CONFLICT (message_id) DO NOTHING;

    IF NOT COALESCE((it ->> 'update_card')::BOOLEAN, TRUE) THEN
      NULL;                                          -- keep the guest's status as it is
    ELSIF v_card IS NOT NULL AND v_channel = 'sms' AND v_key = 'main' THEN
      UPDATE event_cards c SET sms_status = CASE v_state WHEN 'read' THEN 'delivered' ELSE v_state END, sent_at = NOW() WHERE c.id = v_card;
    ELSIF v_card IS NOT NULL AND v_channel = 'whatsapp' AND v_key = 'card' THEN
      v_wa := NULLIF(it ->> 'card_status', '');
      IF v_wa IS NULL OR v_wa NOT IN ('sent','delivered','read','invalid','notSent') THEN
        v_wa := CASE v_state WHEN 'failed' THEN 'notSent' ELSE v_state END;
      END IF;
      UPDATE event_cards c SET wa_status = v_wa, sent_at = NOW() WHERE c.id = v_card;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Applies delivery results (webhook, server check or "Check delivery now"). One item per message:
--   { message_id, status_id, group_id?, status_name?, reason?, done_at? }
-- Only forwards: sent → delivered / read / failed, delivered → read. The guest's own status changes
-- only for the main SMS / the card, only when this is that guest's latest send of it, and not for
-- a send made before a new spreadsheet reset the guest (event_cards.status_reset_at). Each
-- change is written to the event History. Signed-in callers only touch events they can see.
-- → { updated, delivered, read, failed, unknown }
CREATE OR REPLACE FUNCTION public.apply_delivery_results(p_items JSONB, p_source TEXT DEFAULT 'check') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it        JSONB;
  d         message_deliveries%ROWTYPE;
  v_id      INT;
  v_group   INT;
  v_state   TEXT;
  v_name    TEXT;
  v_reason  TEXT;
  v_done    TIMESTAMPTZ;
  v_log     TEXT;
  v_service BOOLEAN := COALESCE(auth.role(), '') = 'service_role';
  v_src     TEXT := CASE WHEN p_source IN ('callback','check') THEN p_source ELSE 'check' END;
  n_upd INT := 0; n_del INT := 0; n_read INT := 0; n_fail INT := 0; n_unknown INT := 0;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT * INTO d FROM message_deliveries m WHERE m.message_id = NULLIF(it ->> 'message_id', '') FOR UPDATE;
    IF NOT FOUND OR (NOT v_service AND NOT (public.has_perm(d.channel, FALSE) AND public.can_see_event(d.event_id))) THEN
      n_unknown := n_unknown + 1; CONTINUE;
    END IF;
    v_id    := NULLIF(it ->> 'status_id', '')::INT;
    v_group := NULLIF(it ->> 'group_id', '')::INT;
    v_state := public.delivery_state(v_id, v_group);
    IF v_state IS NULL OR NOT ((d.status = 'sent' AND v_state <> 'sent') OR (d.status = 'delivered' AND v_state = 'read')) THEN
      CONTINUE;                                      -- nothing new, or it would go backwards
    END IF;
    v_name   := COALESCE(NULLIF(it ->> 'status_name', ''), d.status_name);
    v_reason := NULLIF(it ->> 'reason', '');
    v_done   := COALESCE(NULLIF(it ->> 'done_at', '')::TIMESTAMPTZ, NOW());
    UPDATE message_deliveries m SET status = v_state, status_id = v_id, status_group = COALESCE(v_group, m.status_group),
           status_name = left(v_name, 80), reason = CASE WHEN v_state = 'failed' THEN left(COALESCE(v_reason, v_name), 300) END,
           done_at = v_done, updated_at = NOW(), source = v_src
     WHERE m.id = d.id;

    IF d.event_card_id IS NOT NULL
       AND ((d.channel = 'sms' AND d.message_key = 'main') OR (d.channel = 'whatsapp' AND d.message_key = 'card'))
       AND NOT EXISTS (SELECT 1 FROM message_deliveries n WHERE n.event_card_id = d.event_card_id AND n.channel = d.channel
                          AND n.message_key = d.message_key AND n.sent_at > d.sent_at
                          AND n.sent_at <= NOW())                     -- a send NextSMS holds for later doesn't count yet
       AND NOT EXISTS (SELECT 1 FROM event_cards c WHERE c.id = d.event_card_id
                          AND c.status_reset_at IS NOT NULL AND d.sent_at <= c.status_reset_at) THEN   -- sent before a new spreadsheet reset the guest
      IF d.channel = 'sms' THEN
        UPDATE event_cards c SET sms_status = CASE v_state WHEN 'read' THEN 'delivered' ELSE v_state END WHERE c.id = d.event_card_id;
      ELSE
        UPDATE event_cards c SET wa_status = CASE v_state WHEN 'failed' THEN CASE WHEN v_id IN (76,111,120) THEN 'invalid' ELSE 'notSent' END ELSE v_state END
         WHERE c.id = d.event_card_id;
      END IF;
    END IF;

    v_log := CASE WHEN d.channel = 'whatsapp'
                  THEN CASE v_state WHEN 'failed' THEN CASE WHEN v_id IN (76,111,120) THEN 'invalid' ELSE 'not_sent' END ELSE v_state END
                  ELSE CASE v_state WHEN 'read' THEN 'delivered' ELSE v_state END END;
    INSERT INTO event_logs (event_id, channel, action, status, recipient_name, recipient_phone, message_title, detail, user_email)
    VALUES (d.event_id, d.channel, 'status', v_log, d.recipient_name, d.phone, d.message_title,
            left('Delivery report: ' || COALESCE(CASE WHEN v_state = 'failed' THEN COALESCE(v_reason, v_name) ELSE v_name END, v_state)
                 || ' (' || CASE v_src WHEN 'callback' THEN 'webhook' ELSE 'checked' END || ')', 500),
            'delivery report');
    n_upd := n_upd + 1;
    IF v_state = 'delivered' THEN n_del := n_del + 1; ELSIF v_state = 'read' THEN n_read := n_read + 1; ELSIF v_state = 'failed' THEN n_fail := n_fail + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('updated', n_upd, 'delivered', n_del, 'read', n_read, 'failed', n_fail, 'unknown', n_unknown);
END $$;

-- A WhatsApp button reply (e.g. "Yes, I'll come") from the webhook: kept on the message and
-- written to the event History
CREATE OR REPLACE FUNCTION public.record_delivery_reply(p_message_id TEXT, p_text TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d message_deliveries%ROWTYPE;
BEGIN
  UPDATE message_deliveries m SET reply_text = left(p_text, 500), replied_at = NOW(), updated_at = NOW()
   WHERE m.message_id = p_message_id
  RETURNING * INTO d;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO event_logs (event_id, channel, action, status, recipient_name, recipient_phone, message_title, detail, user_email)
  VALUES (d.event_id, d.channel, 'reply', 'ok', d.recipient_name, d.phone, d.message_title, left('Replied: ' || COALESCE(p_text, ''), 500), 'guest reply');
  RETURN TRUE;
END $$;

-- The messages whose report should be looked up now (server check), stamped as checked.
-- Still waiting and under 3 days old; checked every 4 minutes in their first hour, every
-- 30 minutes until a day old, then every 3 hours.
CREATE OR REPLACE FUNCTION public.claim_pending_deliveries(p_limit INT DEFAULT 200)
RETURNS TABLE (message_id TEXT, channel TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT m.id FROM message_deliveries m
     WHERE m.status = 'sent' AND m.message_id IS NOT NULL AND m.sent_at > NOW() - INTERVAL '3 days' AND m.sent_at <= NOW()
       AND (m.checked_at IS NULL OR m.checked_at < NOW() - CASE WHEN m.sent_at > NOW() - INTERVAL '1 hour' THEN INTERVAL '4 minutes'
                                                               WHEN m.sent_at > NOW() - INTERVAL '1 day'  THEN INTERVAL '30 minutes'
                                                               ELSE INTERVAL '3 hours' END)
     ORDER BY m.checked_at NULLS FIRST, m.sent_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE message_deliveries m SET checked_at = NOW(), checks = m.checks + 1
    FROM due WHERE m.id = due.id
  RETURNING m.message_id, m.channel;
END $$;

REVOKE ALL ON FUNCTION public.record_message_sends(JSONB), public.apply_delivery_results(JSONB, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_message_sends(JSONB), public.apply_delivery_results(JSONB, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_delivery_reply(TEXT, TEXT), public.claim_pending_deliveries(INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_delivery_reply(TEXT, TEXT), public.claim_pending_deliveries(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delivery_state(INT, INT) TO authenticated, service_role;

-- Every 5 minutes, but only while a message is due a check, ask run-schedules to look up
-- delivery reports (same Vault URL and secret as the schedules job in section 9)
DO $outer$
BEGIN
  PERFORM cron.schedule('nikadi-sync-deliveries', '*/5 * * * *', $job$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nikadi_project_url') || '/functions/v1/run-schedules',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nikadi_cron_secret')),
      body    := '{"task":"deliveries"}'::jsonb,
      timeout_milliseconds := 60000)
    WHERE EXISTS (
      SELECT 1 FROM public.message_deliveries m
       WHERE m.status = 'sent' AND m.message_id IS NOT NULL AND m.sent_at > NOW() - INTERVAL '3 days' AND m.sent_at <= NOW()
         AND (m.checked_at IS NULL OR m.checked_at < NOW() - CASE WHEN m.sent_at > NOW() - INTERVAL '1 hour' THEN INTERVAL '4 minutes'
                                                                 WHEN m.sent_at > NOW() - INTERVAL '1 day'  THEN INTERVAL '30 minutes'
                                                                 ELSE INTERVAL '3 hours' END))
  $job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Delivery checks: could not set up pg_cron (%). Turn on pg_cron and pg_net under Database → Extensions, then run this file again.', SQLERRM;
END $outer$;

-- Live delivery results in the app
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE message_deliveries; EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- Live updates for the Scanner tab across devices
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE event_cards; EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE scan_logs;   EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────
-- N. GUEST CARD WEB PAGES — #/g/<event-public-id>/<guest-public-id>
--    Each event and each guest card gets an 8-character public ID
--    (uppercase alphanumeric, excluding easily-confused characters).
--    The public guest page shows the guest's personalised invitation card
--    without requiring login. No personal contact data is exposed.
-- ─────────────────────────────────────────────────────────────────────

-- Generate a random 8-character public ID (no 0/O/I/1/L to avoid misreads)
CREATE OR REPLACE FUNCTION public.gen_public_id() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  chars  TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i      INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
  END LOOP;
  RETURN result;
END $$;

ALTER TABLE events      ADD COLUMN IF NOT EXISTS public_id TEXT UNIQUE;
ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS public_id TEXT UNIQUE;

-- Auto-assign a unique public_id to every new event
CREATE OR REPLACE FUNCTION public.trg_events_public_id() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    LOOP
      NEW.public_id := public.gen_public_id();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM events WHERE public_id = NEW.public_id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_events_public_id ON events;
CREATE TRIGGER trg_events_public_id
  BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION public.trg_events_public_id();

-- Auto-assign a unique public_id to every new guest card
CREATE OR REPLACE FUNCTION public.trg_event_cards_public_id() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    LOOP
      NEW.public_id := public.gen_public_id();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM event_cards WHERE public_id = NEW.public_id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_event_cards_public_id ON event_cards;
CREATE TRIGGER trg_event_cards_public_id
  BEFORE INSERT ON event_cards FOR EACH ROW EXECUTE FUNCTION public.trg_event_cards_public_id();

-- Backfill any existing rows that don't yet have a public_id
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM events WHERE public_id IS NULL LOOP
    UPDATE events SET public_id = public.gen_public_id() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM event_cards WHERE public_id IS NULL LOOP
    UPDATE event_cards SET public_id = public.gen_public_id() WHERE id = r.id;
  END LOOP;
END $$;

-- RPC used by #/g/<event-public-id>/<guest-public-id>: returns enough data to
-- render the guest's personalised invitation page. No auth required; no phone
-- numbers or private fields are returned.
CREATE OR REPLACE FUNCTION public.public_guest_card(p_event_public_id TEXT, p_guest_public_id TEXT)
RETURNS TABLE (
  event_name     TEXT,
  event_type     TEXT,
  start_datetime TIMESTAMPTZ,
  venue_name     TEXT,
  guest_name     TEXT,
  card_type      TEXT,
  card_url       TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.username, e.event_type, e.start_datetime, e.venue_name,
         c.name, c.card_type, c.card_url
    FROM events e
    JOIN event_cards c ON c.event_id = e.id
   WHERE e.public_id  = upper(p_event_public_id)
     AND c.public_id  = upper(p_guest_public_id)
$$;
REVOKE ALL ON FUNCTION public.public_guest_card(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_guest_card(TEXT, TEXT) TO anon, authenticated;

-- ── N. Guest link opt-in ───────────────────────────────────────────────────
-- Events can opt into guest invitation links (default off). The public page
-- is only served when this flag is TRUE so disabling the feature also
-- prevents the page from loading even with a valid URL.

ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_link_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Regenerate RPC with the guest_link_enabled guard so the page returns no
-- data when the organiser has not enabled the feature.
CREATE OR REPLACE FUNCTION public.public_guest_card(p_event_public_id TEXT, p_guest_public_id TEXT)
RETURNS TABLE (
  event_name     TEXT,
  event_type     TEXT,
  start_datetime TIMESTAMPTZ,
  venue_name     TEXT,
  guest_name     TEXT,
  card_type      TEXT,
  card_url       TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.username, e.event_type, e.start_datetime, e.venue_name,
         c.name, c.card_type, c.card_url
    FROM events e
    JOIN event_cards c ON c.event_id = e.id
   WHERE e.public_id          = upper(p_event_public_id)
     AND c.public_id          = upper(p_guest_public_id)
     AND e.guest_link_enabled = TRUE
$$;
REVOKE ALL ON FUNCTION public.public_guest_card(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_guest_card(TEXT, TEXT) TO anon, authenticated;

-- ── O. Card codes, event pages & RSVP ────────────────────────────────────
-- Each printed guest card carries a 4-character human-readable code
-- (3 digits + 1 uppercase letter, randomly ordered) for quick visual
-- identification at the door. The event_pages table holds the microsite
-- settings the organiser can edit per event.

-- 4-char card code generator: 3 digits + 1 letter from the unambiguous set,
-- placed at a random one of the four positions (e.g. "7B42", "A395").
CREATE OR REPLACE FUNCTION public.gen_card_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  digits  TEXT := '0123456789';
  letters TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  d1 CHAR; d2 CHAR; d3 CHAR; l1 CHAR; pos INT;
BEGIN
  d1  := substr(digits,  (floor(random()*10))::int + 1, 1);
  d2  := substr(digits,  (floor(random()*10))::int + 1, 1);
  d3  := substr(digits,  (floor(random()*10))::int + 1, 1);
  l1  := substr(letters, (floor(random()*23))::int + 1, 1);
  pos := (floor(random()*4))::int;
  RETURN CASE pos
    WHEN 0 THEN l1 || d1 || d2 || d3
    WHEN 1 THEN d1 || l1 || d2 || d3
    WHEN 2 THEN d1 || d2 || l1 || d3
    ELSE        d1 || d2 || d3 || l1
  END;
END;
$$;

ALTER TABLE event_cards ADD COLUMN IF NOT EXISTS card_code TEXT;

CREATE OR REPLACE FUNCTION public.trg_fn_event_cards_card_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.card_code IS NULL THEN
    NEW.card_code := gen_card_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_cards_card_code ON event_cards;
CREATE TRIGGER trg_event_cards_card_code
  BEFORE INSERT ON event_cards
  FOR EACH ROW EXECUTE FUNCTION trg_fn_event_cards_card_code();

-- Backfill existing cards
UPDATE event_cards SET card_code = gen_card_code() WHERE card_code IS NULL;

-- ── Event web-page settings ───────────────────────────────────────────────
-- One row per event; organiser edits via EventPageModal in the admin UI.
-- Images are stored in the "event-pages" storage bucket
-- (create it in Supabase: Storage > New bucket "event-pages", set to public).
CREATE TABLE IF NOT EXISTS event_pages (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id             UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  primary_color        TEXT DEFAULT '#00C2FF',
  accent_color         TEXT DEFAULT '#7C3AED',
  bg_color             TEXT DEFAULT '#0A0F1E',
  text_color           TEXT DEFAULT '#FFFFFF',
  hero_image_url       TEXT,
  tagline              TEXT,
  hosts                JSONB DEFAULT '[]'::jsonb,
  schedule             JSONB DEFAULT '[]'::jsonb,
  dress_code_text      TEXT,
  dress_code_image_url TEXT,
  gallery              JSONB DEFAULT '[]'::jsonb,
  rsvp_enabled         BOOLEAN DEFAULT FALSE,
  rsvp_message         TEXT,
  venue_lat            DOUBLE PRECISION,
  venue_lng            DOUBLE PRECISION,
  venue_description    TEXT,
  show_countdown       BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT event_pages_event_id_key UNIQUE (event_id)
);
ALTER TABLE event_pages ADD COLUMN IF NOT EXISTS web_event_name   TEXT;
ALTER TABLE event_pages ADD COLUMN IF NOT EXISTS rsvp_notify_phone TEXT;

-- ── RSVP submissions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_rsvps (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  card_id      UUID REFERENCES event_cards(id) ON DELETE SET NULL,
  attending    BOOLEAN NOT NULL,
  message      TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS: authenticated only; anon submits only via submit_rsvp RPC ────────
ALTER TABLE event_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_event_pages" ON event_pages;
DROP POLICY IF EXISTS "auth_all_event_rsvps" ON event_rsvps;
CREATE POLICY "auth_all_event_pages" ON event_pages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_event_rsvps" ON event_rsvps FOR ALL USING (auth.role() = 'authenticated');

REVOKE ALL ON TABLE event_pages FROM anon;
REVOKE ALL ON TABLE event_rsvps FROM anon;
GRANT ALL ON TABLE event_pages TO authenticated;
GRANT ALL ON TABLE event_rsvps TO authenticated;

-- ── Public RPC: full event page data ─────────────────────────────────────
-- Returns all data the public microsite needs in one JSONB object.
-- p_guest_public_id is optional; pass NULL (or omit) for a plain event page.
CREATE OR REPLACE FUNCTION public.public_event_page_data(
  p_event_public_id TEXT,
  p_guest_public_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event events%ROWTYPE;
  v_page  event_pages%ROWTYPE;
  v_card  event_cards%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events
  WHERE public_id = upper(p_event_public_id)
    AND guest_link_enabled = TRUE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_page FROM event_pages WHERE event_id = v_event.id;

  IF p_guest_public_id IS NOT NULL THEN
    SELECT * INTO v_card FROM event_cards
    WHERE event_id = v_event.id
      AND public_id = upper(p_guest_public_id);
  END IF;

  RETURN jsonb_build_object(
    'event_name',     v_event.username,
    'event_type',     v_event.event_type,
    'start_datetime', v_event.start_datetime,
    'end_datetime',   v_event.end_datetime,
    'venue_name',     v_event.venue_name,
    'venue_address',  v_event.venue_address,
    'page_settings',  CASE WHEN v_page.id IS NOT NULL THEN jsonb_build_object(
      'primary_color',       v_page.primary_color,
      'accent_color',        v_page.accent_color,
      'bg_color',            v_page.bg_color,
      'text_color',          v_page.text_color,
      'hero_image_url',      v_page.hero_image_url,
      'tagline',             v_page.tagline,
      'hosts',               v_page.hosts,
      'schedule',            v_page.schedule,
      'dress_code_text',     v_page.dress_code_text,
      'dress_code_image_url', v_page.dress_code_image_url,
      'gallery',             v_page.gallery,
      'rsvp_enabled',        v_page.rsvp_enabled,
      'rsvp_message',        v_page.rsvp_message,
      'venue_lat',           v_page.venue_lat,
      'venue_lng',           v_page.venue_lng,
      'venue_description',   v_page.venue_description,
      'show_countdown',      v_page.show_countdown,
      'web_event_name',      v_page.web_event_name
    ) ELSE '{}'::jsonb END,
    'cover_image_url', v_event.cover_image_url,
    'guest_name', v_card.name,
    'card_type',  v_card.card_type,
    'card_url',   v_card.card_url,
    'card_code',  v_card.card_code
  );
END;
$$;
REVOKE ALL ON FUNCTION public.public_event_page_data(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_event_page_data(TEXT, TEXT) TO anon, authenticated;

-- ── Public RPC: submit RSVP ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_rsvp(
  p_event_public_id TEXT,
  p_guest_public_id TEXT,
  p_attending       BOOLEAN,
  p_message         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event_id UUID;
  v_card_id  UUID;
BEGIN
  SELECT id INTO v_event_id FROM events
  WHERE public_id = upper(p_event_public_id)
    AND guest_link_enabled = TRUE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Event not found');
  END IF;

  SELECT id INTO v_card_id FROM event_cards
  WHERE event_id = v_event_id
    AND public_id = upper(p_guest_public_id);

  INSERT INTO event_rsvps (event_id, card_id, attending, message)
  VALUES (v_event_id, v_card_id, p_attending, p_message);

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_rsvp(TEXT, TEXT, BOOLEAN, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_rsvp(TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

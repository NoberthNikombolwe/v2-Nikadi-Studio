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
        OR (p_card IS NULL AND length(trim(COALESCE(p_query,''))) >= 2 AND c.name ILIKE '%' || trim(p_query) || '%') )
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
REVOKE ALL ON FUNCTION public.public_scan_event(UUID, TEXT), public.public_find_cards(UUID, TEXT, TEXT, UUID), public.public_recent_scans(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_scan_event(UUID, TEXT), public.public_find_cards(UUID, TEXT, TEXT, UUID), public.public_recent_scans(UUID, TEXT) TO anon, authenticated;

-- Live updates for the Scanner tab across devices
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE event_cards; EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE scan_logs;   EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

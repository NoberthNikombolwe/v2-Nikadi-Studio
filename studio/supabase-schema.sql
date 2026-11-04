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

-- =====================================================================
-- GRANTS  (Supabase requires explicit grants for the Data API on new tables)
-- The app requires login, so anon gets nothing; signed-in users get CRUD.
-- =====================================================================
REVOKE ALL ON public.events          FROM anon;
REVOKE ALL ON public.event_cards     FROM anon;
REVOKE ALL ON public.saved_templates FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_cards     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_templates TO authenticated;

-- service_role: Edge Functions and other server-side calls
GRANT ALL ON public.events          TO service_role;
GRANT ALL ON public.event_cards     TO service_role;
GRANT ALL ON public.saved_templates TO service_role;

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

-- =====================================================================
-- NIKADI STUDIO — Supabase Schema
-- Run this in your Supabase project: SQL Editor > New Query
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards
-- =====================================================================

-- =====================================================================
-- TABLES
-- =====================================================================

-- Events table (one row per event/batch)
CREATE TABLE IF NOT EXISTS public.events (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  username        TEXT        NOT NULL,
  phone           TEXT,
  event_type      TEXT,
  status          TEXT        DEFAULT 'active',
  venue_name      TEXT,
  venue_address   TEXT,
  venue_location  TEXT,
  start_datetime  TIMESTAMPTZ,
  end_datetime    TIMESTAMPTZ,
  cover_image_url TEXT,
<<<<<<< Updated upstream
  elements_layout JSONB,        -- saved card element positions / sizes / colors
  sms_message     TEXT,         -- per-event SMS message template
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS elements_layout JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_message TEXT;

=======
  elements_layout JSONB,
  sms_draft       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

>>>>>>> Stashed changes
-- Cards table (one row per attendee/contact in an event)
CREATE TABLE IF NOT EXISTS public.event_cards (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    UUID        REFERENCES public.events(id) ON DELETE CASCADE,
  name        TEXT,
  card_type   TEXT,
  phone       TEXT,
  wa_status   TEXT        DEFAULT 'idle',
  sms_status  TEXT        DEFAULT 'pending',
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Saved templates table (reusable card designs)
CREATE TABLE IF NOT EXISTS public.saved_templates (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT        NOT NULL,
  cover_image_url TEXT,
  elements_layout JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_event_cards_event_id    ON public.event_cards(event_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at       ON public.events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_templates_created ON public.saved_templates(created_at DESC);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
ALTER TABLE public.events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_templates  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_events"                  ON public.events;
DROP POLICY IF EXISTS "allow_all_event_cards"             ON public.event_cards;
DROP POLICY IF EXISTS "allow_all_saved_templates"         ON public.saved_templates;
DROP POLICY IF EXISTS "authenticated_all_events"          ON public.events;
DROP POLICY IF EXISTS "authenticated_all_event_cards"     ON public.event_cards;
DROP POLICY IF EXISTS "authenticated_all_saved_templates" ON public.saved_templates;

-- Only authenticated (logged-in) users can access data
CREATE POLICY "authenticated_all_events"
  ON public.events FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_all_event_cards"
  ON public.event_cards FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_all_saved_templates"
  ON public.saved_templates FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================================
-- GRANTS  (required from May 30, 2026 for new projects)
-- =====================================================================

-- Revoke from anon — app requires login, no public access needed
REVOKE ALL ON public.events          FROM anon;
REVOKE ALL ON public.event_cards     FROM anon;
REVOKE ALL ON public.saved_templates FROM anon;

-- authenticated role — supabase-js with a logged-in user
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_cards     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_templates TO authenticated;

-- service_role — Edge Functions and server-side calls
GRANT ALL ON public.events          TO service_role;
GRANT ALL ON public.event_cards     TO service_role;
GRANT ALL ON public.saved_templates TO service_role;

-- =====================================================================
-- STORAGE BUCKET  (templates)
-- =====================================================================
-- In Supabase Dashboard: Storage > New Bucket > name "templates" > Public: YES
-- Or via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_templates"          ON storage.objects;
DROP POLICY IF EXISTS "public_insert_templates"        ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_templates"   ON storage.objects;
DROP POLICY IF EXISTS "authenticated_insert_templates" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_templates" ON storage.objects;

CREATE POLICY "authenticated_read_templates"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'templates');

CREATE POLICY "authenticated_insert_templates"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'templates');

CREATE POLICY "authenticated_delete_templates"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'templates');

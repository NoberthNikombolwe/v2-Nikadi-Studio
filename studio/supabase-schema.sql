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
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS elements_layout JSONB;

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
-- =====================================================================
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_templates  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_events"            ON events;
DROP POLICY IF EXISTS "allow_all_event_cards"       ON event_cards;
DROP POLICY IF EXISTS "allow_all_saved_templates"   ON saved_templates;

CREATE POLICY "allow_all_events"          ON events           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_event_cards"     ON event_cards      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_saved_templates" ON saved_templates  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================================
-- STORAGE BUCKET
-- =====================================================================
-- In Supabase Dashboard:
--   1. Go to Storage > New Bucket
--   2. Name: templates
--   3. Public bucket: YES (toggle on)
--   4. Save

-- Or via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_templates"   ON storage.objects;
DROP POLICY IF EXISTS "public_insert_templates" ON storage.objects;

CREATE POLICY "public_read_templates"
  ON storage.objects FOR SELECT USING (bucket_id = 'templates');

CREATE POLICY "public_insert_templates"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'templates');

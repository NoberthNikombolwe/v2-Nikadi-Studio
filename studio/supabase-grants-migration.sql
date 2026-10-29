-- =====================================================================
-- NIKADI STUDIO — Grants Migration
-- Run this NOW in Supabase Dashboard → SQL Editor → New Query
-- Safe to re-run: all statements are idempotent
-- =====================================================================
-- Fixes the Supabase breaking change (effective May 30 / Oct 30, 2026):
-- New tables require explicit GRANTs to be accessible via the Data API.
-- =====================================================================

-- ── 1. Add columns added since the original schema ────────────────────
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sms_draft TEXT;

-- ── 2. Revoke from anon (app requires login — no public access needed) ─
REVOKE ALL ON public.events          FROM anon;
REVOKE ALL ON public.event_cards     FROM anon;
REVOKE ALL ON public.saved_templates FROM anon;

-- ── 3. Grant to authenticated (supabase-js with logged-in user) ────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_cards     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_templates TO authenticated;

-- ── 4. Grant to service_role (Edge Functions / server-side calls) ──────
GRANT ALL ON public.events          TO service_role;
GRANT ALL ON public.event_cards     TO service_role;
GRANT ALL ON public.saved_templates TO service_role;

-- ── 5. Tighten RLS policies to authenticated role only ────────────────
--    (old policies used USING (true) with no role — replaced below)

DROP POLICY IF EXISTS "allow_all_events"            ON public.events;
DROP POLICY IF EXISTS "allow_all_event_cards"       ON public.event_cards;
DROP POLICY IF EXISTS "allow_all_saved_templates"   ON public.saved_templates;
-- also drop the new names so this script (and supabase-schema.sql) can be re-run in any order
DROP POLICY IF EXISTS "authenticated_all_events"            ON public.events;
DROP POLICY IF EXISTS "authenticated_all_event_cards"       ON public.event_cards;
DROP POLICY IF EXISTS "authenticated_all_saved_templates"   ON public.saved_templates;

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

-- ── 6. Storage bucket policies (templates) ────────────────────────────
DROP POLICY IF EXISTS "public_read_templates"   ON storage.objects;
DROP POLICY IF EXISTS "public_insert_templates" ON storage.objects;
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

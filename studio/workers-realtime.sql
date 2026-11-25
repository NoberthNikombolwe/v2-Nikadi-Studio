-- workers-realtime.sql
-- Postgres triggers that push table changes to the Cloudflare Worker via pg_net.
-- The Worker routes each notification to the matching Durable Object, which
-- broadcasts it to all connected WebSocket clients.
--
-- Prerequisites:
--   1. pg_net extension must be enabled (Supabase has it by default).
--   2. Add a Vault secret for the shared token:
--        SELECT vault.create_secret('your-random-secret-here', 'nikadi_realtime_secret');
--      The same value must be set as REALTIME_SECRET in the Cloudflare Worker secrets.
--   3. Run this file once against your Supabase project (Supabase Studio → SQL Editor).
--
-- Channel names (match studio/src/lib/realtime.js and the Worker):
--   deliveries:{event_id}  — message_deliveries changes
--   cards:{event_id}       — event_cards changes
--   schedules:{event_id}   — message_schedules and message_schedule_runs changes
--   schedules-all          — all schedule / run changes (SchedulesTab global view)

-- ── Core helper: fire-and-forget HTTP POST via pg_net ─────────────────────────

CREATE OR REPLACE FUNCTION notify_realtime_worker(p_channel TEXT, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url              := 'https://v2-nikadi-studio.noberthbariki.workers.dev/api/realtime/notify',
    headers          := jsonb_build_object(
      'Content-Type',       'application/json',
      'x-realtime-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nikadi_realtime_secret' LIMIT 1)
    ),
    body             := p_payload::TEXT,
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  NULL;  -- never block the original DML on a failed notification
END;
$$;

-- ── message_deliveries ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_realtime_deliveries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_eid TEXT := COALESCE(NEW.event_id, OLD.event_id)::TEXT;
BEGIN
  PERFORM notify_realtime_worker(
    'deliveries:' || v_eid,
    jsonb_build_object(
      'channel',   'deliveries:' || v_eid,
      'table',     'message_deliveries',
      'eventType', TG_OP,
      'new',       CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
      'old',       CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS realtime_deliveries ON message_deliveries;
CREATE TRIGGER realtime_deliveries
  AFTER INSERT OR UPDATE OR DELETE ON message_deliveries
  FOR EACH ROW EXECUTE FUNCTION trg_realtime_deliveries();

-- ── event_cards ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_realtime_cards()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_eid TEXT := COALESCE(NEW.event_id, OLD.event_id)::TEXT;
BEGIN
  PERFORM notify_realtime_worker(
    'cards:' || v_eid,
    jsonb_build_object(
      'channel',   'cards:' || v_eid,
      'table',     'event_cards',
      'eventType', TG_OP,
      'new',       CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
      'old',       CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS realtime_cards ON event_cards;
CREATE TRIGGER realtime_cards
  AFTER INSERT OR UPDATE OR DELETE ON event_cards
  FOR EACH ROW EXECUTE FUNCTION trg_realtime_cards();

-- ── message_schedules ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_realtime_schedules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_eid     TEXT    := COALESCE(NEW.event_id, OLD.event_id)::TEXT;
  v_payload JSONB;
BEGIN
  v_payload := jsonb_build_object(
    'table',     'message_schedules',
    'eventType', TG_OP,
    'new',       CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    'old',       CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END
  );
  -- per-event channel (useSchedules hook)
  PERFORM notify_realtime_worker('schedules:' || v_eid, v_payload || jsonb_build_object('channel', 'schedules:' || v_eid));
  -- global channel (SchedulesTab)
  PERFORM notify_realtime_worker('schedules-all', v_payload || jsonb_build_object('channel', 'schedules-all'));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS realtime_schedules ON message_schedules;
CREATE TRIGGER realtime_schedules
  AFTER INSERT OR UPDATE OR DELETE ON message_schedules
  FOR EACH ROW EXECUTE FUNCTION trg_realtime_schedules();

-- ── message_schedule_runs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_realtime_schedule_runs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_eid     TEXT    := COALESCE(NEW.event_id, OLD.event_id)::TEXT;
  v_payload JSONB;
BEGIN
  v_payload := jsonb_build_object(
    'table',     'message_schedule_runs',
    'eventType', TG_OP,
    'new',       CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    'old',       CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END
  );
  -- per-event channel (useSchedules hook)
  PERFORM notify_realtime_worker('schedules:' || v_eid, v_payload || jsonb_build_object('channel', 'schedules:' || v_eid));
  -- global channel (SchedulesTab)
  PERFORM notify_realtime_worker('schedules-all', v_payload || jsonb_build_object('channel', 'schedules-all'));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS realtime_schedule_runs ON message_schedule_runs;
CREATE TRIGGER realtime_schedule_runs
  AFTER INSERT OR UPDATE OR DELETE ON message_schedule_runs
  FOR EACH ROW EXECUTE FUNCTION trg_realtime_schedule_runs();

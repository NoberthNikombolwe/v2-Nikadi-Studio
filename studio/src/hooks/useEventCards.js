import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { cfChannel } from "../lib/realtime";

const CARD_COLS = "id,public_id,card_code,name,card_type,phone,wa_status,sms_status,max_scans,scan_count,last_scanned_at,call_status,call_comment,call_updated_at,call_by";

// The open event's cards from the database, kept live with realtime updates
export function useEventCards(eventId) {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    if (!supabase || !eventId) { setCards(null); return; }
    const { data, error: e } = await supabase.from("event_cards").select(CARD_COLS).eq("event_id", eventId).order("name");
    if (e) { setError(e.message); setCards([]); return; }
    setError(null); setCards(data);
  };
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    if (!eventId) return;
    const rt = cfChannel(`cards:${eventId}`);
    rt.on((p) => {
      if (p.eventType === "DELETE") { setCards(cs => cs && cs.filter(c => c.id !== p.old.id)); return; }
      const row = p.new;
      setCards(cs => !cs ? cs : cs.some(c => c.id === row.id) ? cs.map(c => c.id === row.id ? { ...c, ...row } : c) : [...cs, row]);
    }).subscribe();
    return () => rt.unsubscribe();
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (id, changes) => setCards(cs => cs && cs.map(c => c.id === id ? { ...c, ...changes } : c));
  return { cards, error, load, patch };
}

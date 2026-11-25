import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { cfChannel } from "../lib/realtime";

// The open event's delivery results, kept live with realtime. `onChange(row)` sees every live
// insert / update (the app uses it to move guests' badges). `missing` = the delivery SQL (§11)
// isn't installed yet.
export function useDeliveries(eventId, onChange) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const load = async () => {
    if (!supabase || !eventId) { setRows([]); setLoaded(false); return; }
    const { data, error: e } = await supabase.from("message_deliveries").select("*")
      .eq("event_id", eventId).order("sent_at", { ascending: false }).limit(3000);
    if (e) {
      const notSetUp = /message_deliveries|schema cache|does not exist/i.test(e.message);
      setMissing(notSetUp); setError(notSetUp ? null : e.message); setRows([]); setLoaded(true);
      return;
    }
    setMissing(false); setError(null); setRows(data || []); setLoaded(true);
  };
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    if (!eventId) return;
    const rt = cfChannel(`deliveries:${eventId}`);
    rt.on((p) => {
      if (p.eventType === "DELETE") { setRows(rs => rs.filter(r => r.id !== p.old.id)); return; }
      const row = p.new;
      setRows(rs => rs.some(r => r.id === row.id) ? rs.map(r => r.id === row.id ? { ...r, ...row } : r) : [row, ...rs]);
      onChangeRef.current?.(row);
    }).subscribe();
    return () => rt.unsubscribe();
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, loaded, missing, error, load };
}

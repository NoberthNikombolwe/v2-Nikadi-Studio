import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { cfChannel } from "../lib/realtime";

// The open event's schedules for one channel and their sends, kept live with realtime.
// `missing` is true until the schedules SQL (section 9) has been run.
export function useSchedules(eventId, channel) {
  const [schedules, setSchedules] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState(false);
  const load = async () => {
    if (!supabase || !eventId) { setSchedules(null); setRuns([]); return; }
    const { data, error: e } = await supabase.from("message_schedules").select("*")
      .eq("event_id", eventId).eq("channel", channel).order("created_at", { ascending: false });
    if (e) {
      const notSetUp = /message_schedules|schema cache|does not exist/i.test(e.message);
      setMissing(notSetUp); setError(notSetUp ? null : e.message); setSchedules([]); setRuns([]);
      return;
    }
    setMissing(false); setError(null); setSchedules(data || []);
    const ids = (data || []).map(s => s.id);
    if (!ids.length) { setRuns([]); return; }
    const { data: rs, error: re } = await supabase.from("message_schedule_runs")
      .select("id,schedule_id,run_at,status,sent,failed,skipped,detail,started_at,finished_at").in("schedule_id", ids).order("run_at");
    if (re) setError(re.message); else setRuns(rs || []);
  };
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    if (!eventId) return;
    const byTime = (a, b) => new Date(a.run_at) - new Date(b.run_at);

    const scheduleHandler = (p) => {
      if (p.eventType === "DELETE") {
        setSchedules(ss => ss && ss.filter(s => s.id !== p.old.id));
        setRuns(rs => rs.filter(r => r.schedule_id !== p.old.id));
        return;
      }
      const row = p.new;
      if (row.channel !== channel) return;
      setSchedules(ss => !ss ? ss : ss.some(s => s.id === row.id) ? ss.map(s => s.id === row.id ? { ...s, ...row } : s) : [row, ...ss]);
    };

    const runHandler = (p) => {
      if (p.eventType === "DELETE") { setRuns(rs => rs.filter(r => r.id !== p.old.id)); return; }
      const row = p.new;
      setRuns(rs => rs.some(r => r.id === row.id) ? rs.map(r => r.id === row.id ? { ...r, ...row } : r) : [...rs, row].sort(byTime));
    };

    // In production: single DO channel for the event receives both table changes.
    // The handlers above still filter by channel for message_schedules.
    const rt = cfChannel(`schedules:${eventId}`);
    if (rt) {
      rt.on((p) => {
        if (p.table === "message_schedules") scheduleHandler(p);
        else if (p.table === "message_schedule_runs") runHandler(p);
      }).subscribe();
      return () => rt.unsubscribe();
    }

    if (!supabase) return;
    const ch = supabase.channel(`schedules-${channel}-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_schedules", filter: `event_id=eq.${eventId}` }, scheduleHandler)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_schedule_runs", filter: `event_id=eq.${eventId}` }, runHandler)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId, channel]); // eslint-disable-line react-hooks/exhaustive-deps
  return { schedules, runs, error, missing, load };
}

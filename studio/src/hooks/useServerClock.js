import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { clockOffset } from "../lib/schedule";

// Module-level cache shared by every schedule pop-up (measured once, reused for 10 min)
let serverClock = null;

export const DEVICE_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();

// Returns [offsetMs, remeasure()]. offsetMs is null until the first RPC call succeeds.
// Falls back to the device clock silently when supabase isn't available.
export function useServerClock() {
  const [offset, setOffset] = useState(() => serverClock?.offset ?? null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!supabase || (!asked && serverClock && Date.now() - serverClock.at < 10 * 60_000)) return;
    let off = false;
    const sent = Date.now();
    supabase.rpc("server_time").then(({ data, error }) => {
      const o = error ? null : clockOffset(data, sent, Date.now());
      serverClock = { offset: o, at: Date.now() };
      if (!off) setOffset(o);
    });
    return () => { off = true; };
  }, [asked]);
  return [offset, () => setAsked(n => n + 1)];
}

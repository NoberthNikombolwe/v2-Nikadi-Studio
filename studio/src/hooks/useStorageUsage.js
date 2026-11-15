import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// Returns storage usage across all buckets, refreshable. quotaMb defaults to 1024.
export function useStorageUsage(quotaMb) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    if (!supabase) { setRows([]); return; }
    setError(null);
    const { data, error: e } = await supabase.rpc("storage_usage");
    if (e) {
      setRows([]);
      setError(/storage_usage|schema cache/i.test(e.message) ? "Run the latest supabase-schema.sql to see storage use." : e.message);
      return;
    }
    setRows((data || []).map(r => ({ ...r, files: Number(r.files) || 0, bytes: Number(r.bytes) || 0 })));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  const used  = (rows || []).reduce((n, r) => n + r.bytes, 0);
  const total = Math.max(1, Number(quotaMb) || 1024) * 1048576;
  const cards = (rows || []).find(r => r.bucket === "wa-cards") || { files: 0, bytes: 0 };
  return { rows, error, load, used, total, left: Math.max(0, total - used), pct: Math.min(100, used / total * 100), cards };
}

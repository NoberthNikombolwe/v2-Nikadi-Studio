import { useEffect } from "react";

const NOTICE_VISIBLE_MS = 5000;
const logPending = (x) => x.status === "uploading" || x.status === "sending";

// Empties an activity log NOTICE_VISIBLE_MS after its last change, but only once nothing in
// it is still in progress. Any later change restarts the countdown.
export function useAutoClearLog(log, setLog) {
  useEffect(() => {
    if (!log.length || log.some(logPending)) return;
    const t = setTimeout(() => setLog([]), NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [log, setLog]);
}

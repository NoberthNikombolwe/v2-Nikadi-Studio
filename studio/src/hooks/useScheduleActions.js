import { supabase } from "../lib/supabase";

const confirmDelete = async (askDialog, what) =>
  (await askDialog({ title: `Delete ${what}?`, body: "This can't be undone.", actions: [{ value: "yes", label: "Delete", kind: "danger" }] })) === "yes";

// Pause / resume / cancel (via RPC) and delete (Super Admin only) for a schedule.
// Shared by the SMS / WhatsApp panels and the Schedules page.
export function useScheduleActions({ askDialog, showToast, logHistory, reload }) {
  const setStatus = async (s, status) => {
    if (status === "cancelled") {
      const ok = await askDialog({ title: `Cancel "${s.title}"?`,
        body: "Sends still waiting won't go out, and a send in progress stops before its next batch. Sends already made stay in the history. This can't be undone — make a new schedule to start again.",
        actions: [{ value: "yes", label: "Cancel schedule", kind: "danger" }] });
      if (ok !== "yes") return false;
    }
    const { error: e } = await supabase.rpc("set_message_schedule_status", { p_id: s.id, p_status: status });
    if (e) { showToast(`Could not change the schedule: ${e.message}`, "warn"); return false; }
    const verb = { paused: "paused", active: "resumed", cancelled: "cancelled" }[status];
    logHistory({ channel: s.channel, action: "schedule", title: s.title, detail: `Schedule ${verb}` }, s.event_id);
    showToast(`"${s.title}" ${verb}${status === "active" ? " — sends that came due while paused are skipped" : ""}`, status === "cancelled" ? "info" : "success");
    reload();
    return true;
  };
  const remove = async (s) => {
    if (!(await confirmDelete(askDialog, `schedule "${s.title}"${s.sent_by === "nextsms" ? " (NextSMS still sends the SMS it holds)" : ""}`))) return false;
    const { data, error: e } = await supabase.from("message_schedules").delete().eq("id", s.id).select("id");
    if (e || !data?.length) { showToast(`Could not delete the schedule${e ? `: ${e.message}` : ""}`, "warn"); return false; }
    logHistory({ channel: s.channel, action: "schedule", title: s.title, detail: "Schedule deleted" }, s.event_id);
    showToast(`Deleted "${s.title}"`, "success");
    reload();
    return true;
  };
  return { setStatus, remove };
}

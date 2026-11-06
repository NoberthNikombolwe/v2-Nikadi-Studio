// Smart schedules for SMS / WhatsApp sends: the form, its send times, validation and the
// words shown for it. The browser works out every send time (in the user's local time)
// and saves them as a fixed list; the run-schedules Edge Function only sends what is due,
// so it never deals with repeats or time zones.
//
// Form shape:
//   { mode: "dates" | "weekly",
//     dates: [{ date: "2026-11-20", time: "09:00" }],             ← mode "dates"
//     startDate, time, weekdays: [1, 3, 5] (0 = Sunday … 6 = Saturday),
//     everyWeeks: 1–8, stop: "count" | "until", count, until }   ← mode "weekly"
import { CARD_PLACEHOLDERS, placeholdersIn } from "../../supabase/functions/_shared/messaging.js";

export { scheduleTargets, describeTargetSkips, SCHEDULE_AUDIENCES, CARD_PLACEHOLDERS } from "../../supabase/functions/_shared/messaging.js";

export const MAX_SCHEDULE_RUNS = 100;
export const MAX_EVERY_WEEKS = 8;
const EARLIEST_MS = 60_000;         // a send must be at least a minute away when it is saved
const SMS_TSH_PER_PART = 16;

// Monday first, as people plan a week
export const WEEKDAYS = [
  { d: 1, short: "Mon", long: "Monday" },  { d: 2, short: "Tue", long: "Tuesday" },
  { d: 3, short: "Wed", long: "Wednesday" }, { d: 4, short: "Thu", long: "Thursday" },
  { d: 5, short: "Fri", long: "Friday" },  { d: 6, short: "Sat", long: "Saturday" },
  { d: 0, short: "Sun", long: "Sunday" },
];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

// Local calendar date as YYYY-MM-DD
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026-11-20" + "09:00" → a local Date, or null when either part isn't a real date / time
export const parseLocal = (date, time = "00:00") => {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  const tm = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
  if (h > 23 || mi > 59) return null;
  const out = new Date(y, mo - 1, d, h, mi, 0, 0);
  return out.getFullYear() === y && out.getMonth() === mo - 1 && out.getDate() === d ? out : null;
};

// "Mon 9 Nov 09:00" (the year is added when it isn't `refYear`)
export const fmtRun = (date, refYear = new Date().getFullYear()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear() === refYear ? "" : ` ${d.getFullYear()}`;
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// A new schedule: one send tomorrow at 09:00; the weekly fields start this week and, when
// the event has a date, stop on it
export const defaultScheduleForm = (now = new Date(), eventDate = null) => {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ev = eventDate ? new Date(eventDate) : null;
  const until = ev && !Number.isNaN(ev.getTime()) && ev > now ? ymd(ev) : "";
  return {
    mode: "dates",
    dates: [{ date: ymd(tomorrow), time: "09:00" }],
    startDate: ymd(now), time: "09:00", weekdays: [], everyWeeks: 1,
    stop: until ? "until" : "count", count: 3, until,
  };
};

// The local midnight `n` days after `d` (calendar days, safe across clock changes)
const dayPlus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayIndex = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

// Every send time the form describes, sorted. Times less than a minute from `now` are left
// out (`passed` lists them, for the "already passed" note). Stops one past the limit so the
// caller can tell the form asks for too many.
export const buildRunTimes = (form = {}, now = new Date()) => {
  const earliest = now.getTime() + EARLIEST_MS;
  const runs = [], passed = [];
  if (form.mode === "weekly") {
    const start = parseLocal(form.startDate, "00:00");
    const days = new Set((form.weekdays || []).map(Number));
    const every = Math.trunc(Number(form.everyWeeks));
    const byCount = form.stop !== "until";
    const count = Math.trunc(Number(form.count));
    const until = byCount ? null : parseLocal(form.until, "23:59");
    if (!start || !days.size || !(every >= 1) || !/^\d{2}:\d{2}$/.test(form.time || "")
        || (byCount && !(count >= 1)) || (!byCount && !until)) return { runs, passed };
    const monday0 = dayIndex(start) - ((start.getDay() + 6) % 7);   // the Monday of the start week
    for (let k = 0; k < 3700; k++) {                                  // ~10 years: a hard stop
      const day = dayPlus(start, k);
      if (until && day > until) break;
      const week = Math.floor((dayIndex(day) - monday0) / 7);
      if (week % every !== 0 || !days.has(day.getDay())) continue;
      const at = parseLocal(ymd(day), form.time);
      if (!at) continue;
      if (at.getTime() < earliest) { passed.push(at); continue; }
      runs.push(at);
      if ((byCount && runs.length >= count) || runs.length > MAX_SCHEDULE_RUNS) break;
    }
    return { runs, passed };
  }
  for (const row of form.dates || []) {
    const at = parseLocal(row?.date, row?.time);
    if (!at) continue;
    if (at.getTime() < earliest) passed.push(at); else runs.push(at);
  }
  runs.sort((a, b) => a - b);
  return { runs, passed };
};

// Checks the whole schedule pop-up. → { errors: { field: message }, warnings: [text], runs }
//   ctx: { now, eventDate, channel: "sms" | "whatsapp", title, body (SMS text), waTemplate }
// Error keys: title, body, waTemplate, dates, date_<i>, startDate, time, weekdays,
// everyWeeks, count, until, runs.
export const validateSchedule = (form = {}, ctx = {}) => {
  const now = ctx.now || new Date();
  const errors = {}, warnings = [];
  const today = ymd(now);
  const title = String(ctx.title ?? "").trim();
  if (!title) errors.title = "Give the schedule a name, e.g. Reminder";
  else if (title.length > 120) errors.title = "Keep the name under 120 characters";
  if (ctx.channel === "whatsapp") {
    if (!String(ctx.waTemplate || "").trim()) errors.waTemplate = "Pick a WhatsApp template";
  } else {
    const body = String(ctx.body ?? "");
    if (!body.trim()) errors.body = "Write the SMS text";
    else {
      const unknown = placeholdersIn(body).filter(p => !CARD_PLACEHOLDERS.includes(p));
      if (unknown.length) {
        errors.body = `${unknown.map(p => `{${p}}`).join(", ")} can't be filled in on a schedule — use {name}, {cardType} or {phone}`;
      }
    }
  }

  if (form.mode === "weekly") {
    const start = parseLocal(form.startDate, "00:00");
    if (!start) errors.startDate = "Pick a start date";
    else if (form.startDate < today) errors.startDate = "The start date has passed — pick today or later";
    if (!parseLocal(today, form.time)) errors.time = "Pick a time";
    if (!(form.weekdays || []).length) errors.weekdays = "Pick at least one day";
    const every = Number(form.everyWeeks);
    if (!Number.isInteger(every) || every < 1 || every > MAX_EVERY_WEEKS) errors.everyWeeks = `Every 1 to ${MAX_EVERY_WEEKS} weeks`;
    if (form.stop === "until") {
      if (!parseLocal(form.until, "00:00")) errors.until = "Pick the last day";
      else if (form.until < today) errors.until = "That day has passed";
      else if (start && form.until < form.startDate) errors.until = "The last day is before the start date";
    } else {
      const n = Number(form.count);
      if (!Number.isInteger(n) || n < 1) errors.count = "At least 1 send";
      else if (n > MAX_SCHEDULE_RUNS) errors.count = `At most ${MAX_SCHEDULE_RUNS} sends`;
    }
  } else {
    const rows = form.dates || [];
    if (!rows.length) errors.dates = "Add at least one date";
    const seen = new Map();
    rows.forEach((row, i) => {
      const at = parseLocal(row?.date, row?.time);
      if (!at) { errors[`date_${i}`] = "Pick a date and a time"; return; }
      if (at.getTime() < now.getTime() + EARLIEST_MS) { errors[`date_${i}`] = "This time has passed — pick a later one"; return; }
      const key = at.getTime();
      if (seen.has(key)) errors[`date_${i}`] = `Same time as send ${seen.get(key) + 1}`;
      else seen.set(key, i);
    });
  }

  const { runs, passed } = buildRunTimes(form, now);
  const formOk = !Object.keys(errors).some(k => k !== "title" && k !== "body" && k !== "waTemplate");
  if (formOk) {
    if (!runs.length) errors.runs = "No send is left — every time falls in the past or outside the chosen dates";
    else if (runs.length > MAX_SCHEDULE_RUNS) errors.runs = `That makes more than ${MAX_SCHEDULE_RUNS} sends — pick fewer days or an earlier last day`;
  }
  if (formOk && form.mode === "weekly" && runs.length && passed.some(p => ymd(p) === today)) {
    warnings.push(`Today's ${form.time} has already passed — the first send is ${fmtRun(runs[0], now.getFullYear())}`);
  }
  const ev = ctx.eventDate ? new Date(ctx.eventDate) : null;
  if (ev && !Number.isNaN(ev.getTime()) && runs.length) {
    const after = runs.filter(r => r > ev).length;
    if (after) warnings.push(`${after} send${after === 1 ? " is" : "s are"} after the event (${fmtRun(ev, now.getFullYear())})`);
  }
  return { errors, warnings, runs: runs.slice(0, MAX_SCHEDULE_RUNS + 1) };
};

// One line for the form: "Mon, Wed, Fri at 09:00 · every week · 30 sends"
export const describeSchedule = (form = {}) => {
  if (form.mode === "weekly") {
    const picked = WEEKDAYS.filter(w => (form.weekdays || []).map(Number).includes(w.d)).map(w => w.short);
    const days = picked.length === 7 ? "Every day" : picked.join(", ") || "No day picked";
    const every = Number(form.everyWeeks) > 1 ? `every ${Number(form.everyWeeks)} weeks` : "every week";
    const end = form.stop === "until"
      ? (parseLocal(form.until, "00:00") ? `until ${fmtRun(parseLocal(form.until, "00:00")).replace(/ 00:00$/, "")}` : "")
      : `${Number(form.count) || 0} send${Number(form.count) === 1 ? "" : "s"}`;
    return [`${days} at ${form.time || "--:--"}`, every, end].filter(Boolean).join(" · ");
  }
  const n = (form.dates || []).length;
  if (n === 1) {
    const at = parseLocal(form.dates[0]?.date, form.dates[0]?.time);
    return at ? `Once: ${fmtRun(at)}` : "Once";
  }
  return `${n} chosen date${n === 1 ? "" : "s"}`;
};

// When editing, the form starts from what was saved, but only the sends still waiting are
// replaced: past dates are dropped, a weekly start moves to today, and a "number of sends"
// counts only the ones still to come.
export const formForEdit = (pattern = {}, { now = new Date(), doneRuns = 0 } = {}) => {
  const base = defaultScheduleForm(now);
  const form = { ...base, ...(pattern && typeof pattern === "object" ? pattern : {}) };
  form.mode = form.mode === "weekly" ? "weekly" : "dates";
  form.weekdays = Array.isArray(form.weekdays) ? form.weekdays.map(Number).filter(d => d >= 0 && d <= 6) : [];
  form.dates = (Array.isArray(form.dates) ? form.dates : [])
    .map(r => ({ date: String(r?.date || ""), time: String(r?.time || "") }))
    .filter(r => { const at = parseLocal(r.date, r.time); return !at || at.getTime() >= now.getTime() + EARLIEST_MS; });
  if (form.mode === "dates" && !form.dates.length) form.dates = base.dates;
  if (!form.startDate || form.startDate < ymd(now)) form.startDate = ymd(now);
  if (form.stop !== "until") form.count = Math.max(1, (Number(form.count) || 1) - (Number(doneRuns) || 0));
  return form;
};

// What gets stored with the schedule (so it can be described and edited later)
export const patternOf = (form = {}) => form.mode === "weekly"
  ? { mode: "weekly", startDate: form.startDate, time: form.time, weekdays: [...(form.weekdays || [])].map(Number).sort(),
      everyWeeks: Number(form.everyWeeks) || 1, stop: form.stop === "until" ? "until" : "count",
      count: Number(form.count) || 1, until: form.until || "" }
  : { mode: "dates", dates: (form.dates || []).map(r => ({ date: r.date, time: r.time })) };

// SMS parts, as the SMS tab counts them (160 characters, 153 per part when longer)
export const smsParts = (text = "") => { const n = String(text).length; return n <= 160 ? 1 : Math.ceil(n / 153); };

// Rough cost of a schedule: every send × guests × parts of the longest message
export const estimateSms = (runCount, guests, parts = 1) => {
  const messages = Math.max(0, runCount) * Math.max(0, guests) * Math.max(1, parts);
  return { messages, tsh: messages * SMS_TSH_PER_PART };
};

// Who can be chosen as the audience. "Not sent yet" only makes sense for the main SMS or
// the WhatsApp card, whose sent status is stored per guest.
export const audienceOptions = ({ channel = "sms", messageKey = "custom", image = false } = {}) => [
  { value: "all",          label: "Everyone" },
  ...((channel === "sms" ? messageKey === "main" : image) ? [{ value: "not_sent", label: "Not sent yet" }] : []),
  { value: "confirmed",    label: "Said Yes on calls" },
  { value: "not_declined", label: "Everyone except No" },
];

export const AUDIENCE_LABEL = { all: "Everyone", not_sent: "Not sent yet", confirmed: "Said Yes on calls", not_declined: "Everyone except No" };

// Badges for a schedule and for one of its sends
export const SCHEDULE_STATUS = {
  active:    { label: "Active",    badge: "badge-sent" },
  paused:    { label: "Paused",    badge: "badge-testing" },
  done:      { label: "Finished",  badge: "badge-yes" },
  cancelled: { label: "Cancelled", badge: "badge-idle" },
};
export const RUN_STATUS = {
  pending:   { label: "Waiting",   badge: "badge-idle" },
  sending:   { label: "Sending",   badge: "badge-sent" },
  done:      { label: "Sent",      badge: "badge-yes" },
  failed:    { label: "Failed",    badge: "badge-no" },
  skipped:   { label: "Skipped",   badge: "badge-testing" },
  cancelled: { label: "Cancelled", badge: "badge-idle" },
};

// Schedules page filters: q (name / event / message), channel, status ("live" = active or
// paused), eventId. Each schedule may carry `event_name` (joined in by the page).
export const filterSchedules = (list = [], { q = "", channel = "all", status = "live", eventId = "all" } = {}) => {
  const term = q.trim().toLowerCase();
  return list.filter(s =>
    (channel === "all" || s.channel === channel)
    && (status === "all" || (status === "live" ? s.status === "active" || s.status === "paused" : s.status === status))
    && (eventId === "all" || s.event_id === eventId)
    && (!term || [s.title, s.event_name, s.body, s.wa_template].some(v => String(v || "").toLowerCase().includes(term))));
};

// Numbers for the Schedules page. `waiting` = runs still to send ({ schedule_id, run_at, status }).
export const summariseSchedules = (list = [], waiting = [], now = new Date()) => {
  const count = (st) => list.filter(s => s.status === st).length;
  const live = new Set(list.filter(s => s.status === "active").map(s => s.id));
  const weekEnd = now.getTime() + 7 * 86_400_000;
  const pending = waiting.filter(r => live.has(r.schedule_id) && (r.status === "pending" || r.status === "sending"));
  return {
    active: count("active"), paused: count("paused"), done: count("done"), cancelled: count("cancelled"),
    dueToday: pending.filter(r => ymd(new Date(r.run_at)) === ymd(now)).length,
    dueWeek: pending.filter(r => new Date(r.run_at).getTime() <= weekEnd).length,
  };
};

// The next send still waiting (runs sorted or not), or null
export const nextRun = (runs = []) => runs
  .filter(r => r && (r.status === "pending" || r.status === "sending"))
  .sort((a, b) => new Date(a.run_at) - new Date(b.run_at))[0] || null;

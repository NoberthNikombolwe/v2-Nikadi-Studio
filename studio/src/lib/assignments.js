// Event team: which users are assigned to which event (event_assignments), and what
// they do there. Super Admin / Admin (and any role with "sees all events") see every
// event; everyone else only sees events they're assigned to or created — the database
// enforces this with can_see_event() in supabase-roles-settings-scan.sql.

export const TASK_SUGGESTIONS = ["Owner", "Sales", "Designer", "Sending", "Calls", "Door / check-in", "Finance", "Support"];

// event_assignments rows → { event_id: [row, ...] } sorted by name/email
export const groupAssignments = (rows = []) => {
  const out = {};
  for (const r of rows) (out[r.event_id] || (out[r.event_id] = [])).push(r);
  for (const k of Object.keys(out)) out[k].sort((a, b) => label(a).localeCompare(label(b)));
  return out;
};

const label = (a) => (a.full_name || a.email || "").toLowerCase();

// Up to two initials from a name, else from the email ("amina.said@x" → "AS")
export const initials = (name, email = "") => {
  const src = String(name || "").trim() || String(email).split("@")[0].replace(/[._-]+/g, " ");
  const parts = src.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Events assigned to `email` (lower-cased compare)
export const eventsAssignedTo = (events = [], byEvent = {}, email = "") => {
  const me = String(email).toLowerCase();
  return events.filter(e => (byEvent[e.id] || []).some(a => a.email === me));
};

// Users that can still be added to an event (active, not already on its team)
export const assignableFor = (users = [], team = []) => {
  const taken = new Set(team.map(a => a.email));
  return users.filter(u => u.active !== false && !taken.has(u.email));
};

// Field errors for the add-to-team form
export const validateAssignment = ({ email = "", task = "" } = {}, team = []) => {
  const errors = {};
  if (!email) errors.email = "Choose a person";
  else if (team.some(a => a.email === email)) errors.email = "Already on this event's team";
  if (String(task).length > 40) errors.task = "Keep the task short (40 characters)";
  return errors;
};

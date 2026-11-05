// Guest confirmation calls (event_cards.call_status). Flow, kept from the scanner branch:
// nothing yet → Picked up / Busy → Coming (yes) / Not coming (no). Picking the active
// status again clears it.

export const CALL_STATUSES = {
  picked: { label: "Picked up",  short: "P",   tone: "info", icon: "phone" },
  busy:   { label: "Busy / no answer", short: "B", tone: "warn", icon: "phone" },
  yes:    { label: "Coming",     short: "Yes", tone: "good", icon: "check" },
  no:     { label: "Not coming", short: "No",  tone: "bad",  icon: "xCircle" },
};

// Which status buttons to show for a card's current status (progressive disclosure)
export const callOptions = (status) => {
  if (!status) return ["picked", "busy", "yes", "no"];
  if (status === "picked" || status === "busy") return [status, "yes", "no"];
  return [status];
};

// The status after tapping `choice` (tapping the current one clears it)
export const nextCallStatus = (current, choice) => (current === choice ? null : choice);

// Counts for the Calls summary. `peopleOf(card)` gives the people a card admits.
export const summariseCalls = (cards = [], peopleOf = () => 1) => {
  const s = { total: 0, called: 0, yes: 0, no: 0, busy: 0, picked: 0, notCalled: 0, peopleYes: 0, peopleExpected: 0 };
  for (const c of cards) {
    const p = peopleOf(c);
    s.total++;
    if (c.call_status) s.called++; else s.notCalled++;
    if (c.call_status && s[c.call_status] !== undefined) s[c.call_status]++;
    if (c.call_status === "yes") s.peopleYes += p;
    if (c.call_status !== "no") s.peopleExpected += p;   // everyone but a confirmed "no" may still come
  }
  return s;
};

// Filters cards for the Calls list: "all" | "todo" (not called) | a status; free text over name/phone
export const filterCalls = (cards = [], { status = "all", q = "" } = {}) => {
  const needle = q.trim().toLowerCase(), digits = needle.replace(/\D/g, "");
  return cards.filter(c => {
    if (status === "todo" ? !!c.call_status : status !== "all" && c.call_status !== status) return false;
    if (!needle) return true;
    if (String(c.name || "").toLowerCase().includes(needle)) return true;
    return digits.length >= 3 && String(c.phone || "").includes(digits);
  });
};

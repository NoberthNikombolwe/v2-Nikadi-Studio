// User feedback about the system (app_feedback table): problems, ideas, questions, praise.
// Everyone can send feedback and read their own (with the team's reply); the Feedback
// module answers it and moves it through the statuses below.

export const FEEDBACK_KINDS = {
  problem:  { label: "Problem",  icon: "alert", badge: "badge-no",      hint: "Something doesn't work or looks wrong" },
  idea:     { label: "Idea",     icon: "bulb",  badge: "badge-purple",  hint: "A feature or change you'd like" },
  question: { label: "Question", icon: "help",  badge: "badge-sent",    hint: "How do I…?" },
  praise:   { label: "Praise",   icon: "star",  badge: "badge-yes",     hint: "Something that works well" },
};

export const FEEDBACK_STATUSES = {
  new:      { label: "New",       badge: "badge-testing" },
  seen:     { label: "Seen",      badge: "badge-sent" },
  planned:  { label: "Planned",   badge: "badge-purple" },
  done:     { label: "Done",      badge: "badge-yes" },
  wont_fix: { label: "Won't do",  badge: "badge-idle" },
};
// Statuses that still need the team's attention
export const OPEN_FEEDBACK = ["new", "seen", "planned"];

export const FEEDBACK_MAX = 4000;

// Checks the feedback form. → { field: message } (empty when it can be sent)
export const validateFeedback = ({ kind, rating, message } = {}) => {
  const errors = {};
  if (!FEEDBACK_KINDS[kind]) errors.kind = "Choose what kind of feedback this is";
  // 0 / empty = not rated
  if (rating && !(Number.isInteger(Number(rating)) && rating >= 1 && rating <= 5)) {
    errors.rating = "Rate from 1 to 5 stars, or leave it empty";
  }
  const text = String(message ?? "").trim();
  if (text.length < 3) errors.message = "Tell us a little more (at least 3 characters)";
  else if (text.length > FEEDBACK_MAX) errors.message = `Keep it under ${FEEDBACK_MAX.toLocaleString()} characters`;
  return errors;
};

// Short description of the device, so a problem can be reproduced: "Chrome · Android · 412×915"
export const deviceSummary = ({ userAgent = "", width, height } = {}) => {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const size = width && height ? `${width}×${height}` : "";
  return [browser, os, size].filter(Boolean).join(" · ");
};

// The row to insert (created_by, status and dates are set by the database)
export const feedbackToRow = ({ kind, rating, message } = {}, { page, eventId, device } = {}) => ({
  kind,
  rating: rating ? Number(rating) : null,
  message: String(message ?? "").trim(),
  page: page || null,
  event_id: eventId || null,
  device: device || null,
});

// Feedback list filters: q (message / sender / page), status ("open" = still needs attention), kind
export const filterFeedback = (list = [], { q = "", status = "all", kind = "all" } = {}) => {
  const term = q.trim().toLowerCase();
  return list.filter(f =>
    (status === "all" || (status === "open" ? OPEN_FEEDBACK.includes(f.status) : f.status === status))
    && (kind === "all" || f.kind === kind)
    && (!term || [f.message, f.created_by, f.page, f.reply].some(v => String(v || "").toLowerCase().includes(term))));
};

// Numbers for the Feedback tab: total, per status, still open, average rating (null when none rated)
export const summariseFeedback = (list = []) => {
  const byStatus = Object.fromEntries(Object.keys(FEEDBACK_STATUSES).map(k => [k, 0]));
  const byKind = Object.fromEntries(Object.keys(FEEDBACK_KINDS).map(k => [k, 0]));
  let rated = 0, stars = 0;
  for (const f of list) {
    if (byStatus[f.status] !== undefined) byStatus[f.status]++;
    if (byKind[f.kind] !== undefined) byKind[f.kind]++;
    if (f.rating) { rated++; stars += Number(f.rating); }
  }
  return {
    total: list.length, byStatus, byKind,
    open: OPEN_FEEDBACK.reduce((n, s) => n + byStatus[s], 0),
    avgRating: rated ? Math.round((stars / rated) * 10) / 10 : null, rated,
  };
};

// Rows for the Excel export
export const feedbackExportRows = (list = []) => list.map(f => ({
  "Date": f.created_at ? new Date(f.created_at).toISOString().slice(0, 16).replace("T", " ") : "",
  "From": f.created_by || "",
  "Kind": FEEDBACK_KINDS[f.kind]?.label || f.kind || "",
  "Rating": f.rating || "",
  "Message": f.message || "",
  "Page": f.page || "",
  "Status": FEEDBACK_STATUSES[f.status]?.label || f.status || "",
  "Reply": f.reply || "",
  "Replied by": f.replied_by || "",
  "Device": f.device || "",
}));

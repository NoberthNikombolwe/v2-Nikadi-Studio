// Roles & permissions. The database (role_permissions + has_perm() in
// supabase-roles-settings-scan.sql) is the real gate; this mirrors it so the UI can hide
// what a role can't use. DEFAULT_MATRIX must match the SQL seed.

export const ROLES = [
  { key: "superuser",         label: "Super Admin",       description: "Sees and manages everything — the only role that can delete data" },
  { key: "admin",             label: "Admin",             description: "Runs the system day to day; manages users and settings" },
  { key: "sales_officer",     label: "Sales Officer",     description: "Leads, customers and events" },
  { key: "graphics_designer", label: "Graphics Designer", description: "Card design, guest lists and WhatsApp delivery" },
  { key: "help_desk",         label: "Help Desk",         description: "Door check-in, guest calls and SMS support" },
  { key: "telesales",         label: "Tele Sales",        description: "Phone follow-ups and guest confirmation calls" },
  { key: "finance_officer",   label: "Finance Officer",   description: "Income, expenses and event profit" },
];
export const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.key, r.label]));

export const MODULES = [
  { key: "events", label: "Events" }, { key: "leads", label: "Leads" }, { key: "customers", label: "Customers" },
  { key: "design", label: "Design" }, { key: "vcard", label: "VCard" }, { key: "sms", label: "SMS" },
  { key: "whatsapp", label: "WhatsApp" }, { key: "batch", label: "Batch & Send" }, { key: "reports", label: "Reports" },
  { key: "history", label: "History" }, { key: "finance", label: "Finance" }, { key: "scanner", label: "Scanner" },
  { key: "calls", label: "Calls" }, { key: "settings", label: "Settings" }, { key: "users", label: "Users & roles" },
  { key: "feedback", label: "Feedback" },
];

// "E" = view + edit, "V" = view only; missing = no access. Super Admin (key "superuser") is always everything.
const M = (s) => Object.fromEntries(s.split(" ").filter(Boolean).map(x => x.split(":")));
export const DEFAULT_MATRIX = {
  admin:             M("events:E leads:E customers:E design:E vcard:E sms:E whatsapp:E batch:E reports:E history:E finance:E scanner:E calls:E settings:E users:E feedback:E"),
  sales_officer:     M("events:E leads:E customers:E design:V vcard:V batch:V sms:E whatsapp:V reports:V history:V calls:V"),
  graphics_designer: M("events:V design:E vcard:E batch:E whatsapp:E reports:V history:V"),
  help_desk:         M("events:V customers:V sms:E reports:V history:V scanner:E calls:E"),
  telesales:         M("events:V leads:E customers:V sms:E reports:V calls:E"),
  finance_officer:   M("events:V customers:V reports:V history:V finance:E"),
};

// role_permissions rows → { role: { module: "E" | "V" } }
export const matrixFromRows = (rows = []) => {
  const m = {};
  for (const r of rows) {
    if (!r.can_view && !r.can_edit) continue;
    (m[r.role] || (m[r.role] = {}))[r.module] = r.can_edit ? "E" : "V";
  }
  return m;
};

// Can `role` view / edit `module`? `matrix` from matrixFromRows (falls back to the defaults)
export const can = (matrix, role, module, level = "view") => {
  if (!role) return false;
  if (role === "superuser") return true;
  const p = (matrix || DEFAULT_MATRIX)[role]?.[module];
  return level === "edit" ? p === "E" : p === "E" || p === "V";
};

// Which module each app tab belongs to (the Guide is for everyone)
export const TAB_MODULE = {
  events: "events", leads: "leads", customers: "customers", design: "design", vcard: "vcard", sms: "sms",
  whatsapp: "whatsapp", batch: "batch", reports: "reports", history: "history", finance: "finance",
  scanner: "scanner", calls: "calls", settings: "settings", feedback: "feedback", guide: null,
  schedules: "sms",   // shown with SMS or WhatsApp (see canSeeTab); each schedule checks its own channel
};

export const canSeeTab = (matrix, role, tab) => {
  const m = TAB_MODULE[tab];
  if (m === null) return !!role;
  if (tab === "settings") return can(matrix, role, "settings") || can(matrix, role, "users");
  if (tab === "schedules") return can(matrix, role, "sms") || can(matrix, role, "whatsapp");
  return can(matrix, role, m);
};

// Nav groups filtered to what the role may see (empty groups dropped)
export const visibleNav = (groups, matrix, role) => groups
  .map(g => ({ ...g, items: g.items.filter(it => canSeeTab(matrix, role, it.id)) }))
  .filter(g => g.items.length);

// The rows to write when the matrix editor saves one role (all modules, explicit false)
export const rowsForRole = (role, perms = {}) => MODULES.map(m => ({
  role, module: m.key, can_view: perms[m.key] === "V" || perms[m.key] === "E", can_edit: perms[m.key] === "E",
}));

// Basic email check for the invite form
export const validateInvite = ({ email = "", role = "" } = {}, { allowSuperuser = false } = {}) => {
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address";
  if (!ROLE_LABEL[role]) errors.role = "Choose a role";
  else if (role === "superuser" && !allowSuperuser) errors.role = "Only a Super Admin can create a Super Admin";
  return errors;
};

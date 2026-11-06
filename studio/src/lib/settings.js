// Dynamic settings (app_settings, wa_templates, sender_ids) — pure helpers.

export const DEFAULT_SETTINGS = { org_name: "Nikadi Studio", country_code: "255", wa_account: "Nikadi", numeric_card_types: true, default_people: 1, storage_quota_mb: 1024 };

// app_settings rows → { key: value } merged over the defaults
export const settingsFromRows = (rows = []) => ({ ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) });

// The default active item (is_default), else the first active one, else null
export const pickDefault = (list = []) => {
  const active = list.filter(x => x.active !== false);
  return active.find(x => x.is_default) || active[0] || null;
};

// Template / sender to use for an event: its own choice when still active, else the default
export const resolveChoice = (list = [], chosen, key) => {
  const active = list.filter(x => x.active !== false);
  return (chosen && active.find(x => x[key] === chosen)) || pickDefault(list);
};

export const validateTemplate = (form = {}, list = []) => {
  const errors = {};
  const name = String(form.name || "").trim();
  if (!name) errors.name = "Template name is required (exactly as registered with the provider)";
  else if (!/^[\w.-]{1,64}$/.test(name)) errors.name = "Use letters, numbers, _ . - only (no spaces)";
  else if (list.some(t => !(form.id && t.id === form.id) && t.name.toLowerCase() === name.toLowerCase())) errors.name = "This template already exists";
  return errors;
};

// SMS sender IDs: 1–11 letters/digits (spaces allowed), the usual operator limit
export const validateSenderId = (form = {}, list = []) => {
  const errors = {};
  const v = String(form.sender_id || "").trim();
  if (!v) errors.sender_id = "Sender ID is required";
  else if (!/^[A-Za-z0-9 ]{1,11}$/.test(v)) errors.sender_id = "Up to 11 letters or numbers";
  else if (list.some(s => !(form.id && s.id === form.id) && s.sender_id.toLowerCase() === v.toLowerCase())) errors.sender_id = "This sender ID already exists";
  return errors;
};

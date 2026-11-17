# Nikadi Studio — Project Implementation

**Last updated:** 2026-11-16

---

## 1. Development Conventions

### 1.1 The Single-File Rule

`src/App.jsx` is intentionally a single large file (~3 000 lines). **Do not split it.**

The file is organised by section comments:
```js
/* ══════════════════════════════════════════════════════════════════════════
   SECTION NAME
══════════════════════════════════════════════════════════════════════════ */
```

New components are added within the file, in the logical section they belong to.

### 1.2 Pure Logic in `src/lib/`

Anything that is not React goes in `src/lib/`:
- Pure functions only — no `useState`, no `useEffect`, no Supabase calls
- Exported as named exports
- Unit-tested in `src/lib/lib.test.js`
- Code shared with Edge Functions goes in `supabase/functions/_shared/` and is re-exported from the lib file

### 1.3 State Management

All state lives in `<App>`. Child components receive what they need as props. No context (except `CanDeleteContext`), no external state library.

```js
// Good: prop drilling is intentional
<CallsTab
  eventId={savedEventId}
  eventRow={openEventRow}
  canEdit={canEdit}
  canDelete={canDelete}
  showToast={showToast}
/>

// Bad: creating a new context for convenience
```

### 1.4 Colour and Styling

```js
// Always use N.* tokens and alpha()
style={{ color: N.sky, background: alpha(N.accent, "1a"), border: `1px solid ${N.border}` }}

// Never
style={{ color: "#38bdf8", background: "#7c3aed22" }}   // hardcoded colours
style={{ color: `${N.sky}44` }}                          // hex alpha on CSS var — does NOT work
```

### 1.5 Icons

```jsx
// Good
<Icon n="save" />

// Bad
// (emoji) 💾
// (HTML entity) &#x1F4BE;
```

### 1.6 Delete Buttons

Every delete button must check `canDelete`:

```jsx
const canDelete = useContext(CanDeleteContext);  // or passed as prop

{canDelete && (
  <Sb bg={N.redBg} col={N.red} border={alpha(N.red,"44")} onClick={() => deleteItem(item)}>
    <Icon n="trash" /> Delete
  </Sb>
)}
```

### 1.7 URLs

```js
// Good
const url = `${location.origin}${location.pathname}#/g/${eventId}/${guestId}`;
const imgSrc = `${import.meta.env.BASE_URL}favicon.svg`;

// Bad
const url = "/g/abc123";   // root-absolute breaks on Heroku sub-path
```

### 1.8 Modal Closing

```jsx
// Good — only close via button
<button className="nk-modal-close" onClick={onClose}><Icon n="x" /></button>
<button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>

// Bad — backdrop click or Escape key listeners
<div className="nk-overlay" onClick={onClose} />     // NO
useEffect(() => {
  const h = e => { if (e.key === "Escape") onClose(); };
  document.addEventListener("keydown", h);
}, []);                                              // NO
```

---

## 2. Adding a New Tab

1. Add the tab key to `NAV_GROUPS` in `<App>` JSX (or the matching `const NAV_GROUPS` definition)
2. Add a `TAB_MODULE` entry in `src/lib/permissions.js`
3. Add a `{tab === "newtab" && (<NewTabComponent .../>)}` block in the tab body area of `<App>`
4. Add the tab's module to `app_modules` seed data in `supabase-roles-settings-scan.sql`
5. Set the default permissions in `DEFAULT_MATRIX` (`src/lib/permissions.js`) and the SQL seed

---

## 3. Adding a New Table

1. Add `CREATE TABLE IF NOT EXISTS ...` to `supabase-schema.sql`
2. Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
3. Add policies: `authenticated_all_<table>` for CRUD; `p_<table>_delete_super_admin` for delete restriction
4. Add `REVOKE ALL ON ... FROM anon; GRANT ... TO authenticated;`
5. Add an index on the foreign key column (`event_id` etc.)
6. Never add an `anon` policy

---

## 4. Adding a New Public RPC

For RPCs callable by the `anon` role (public pages only):

```sql
CREATE OR REPLACE FUNCTION public.my_public_rpc(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- validate the code / guard conditions first
  IF p_code IS NULL OR length(p_code) < 4 THEN RETURN NULL; END IF;

  SELECT jsonb_build_object('field', t.field)
  INTO v_result
  FROM my_table t
  WHERE t.code = upper(p_code);

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.my_public_rpc(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.my_public_rpc(TEXT) TO anon, authenticated;
```

**Rules:**
- Always `SECURITY DEFINER SET search_path = public`
- Always `REVOKE ALL FROM public` then explicitly `GRANT` to needed roles
- Expose only the minimum fields needed
- Never expose phone numbers, emails, or internal IDs from public RPCs

---

## 5. Adding a New Field to an Existing Form

Example: adding a `venue_region` field to `EventModal`:

1. Add `ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_region TEXT;` to `supabase-schema.sql`
2. Add `venue_region: ""` to `BLANK_EVENT`
3. Add `"venue_region"` to `EVENT_FORM_FIELDS` (or `NULLABLE_EVENT_FIELDS` if it can be null)
4. Add the form input in `EventModal`'s JSX
5. Add `REVOKE`/`GRANT` if it's a new table (not needed for existing column on existing table)

---

## 6. Card Records Shape

Each record in the `records` array:

```js
{
  // Identity
  dbId: "uuid",           // event_cards.id (null for unsaved)
  publicId: "ABC12345",   // event_cards.public_id (8-char)
  cardCode: "7B42",       // event_cards.card_code (4-char display code)

  // Guest data (from spreadsheet + DB)
  name: "Juma Hassan",
  cardType: "DOUBLE",
  phone: "255712345678",

  // Status
  waStatus: "sent",       // WA.idle|sending|sent|delivered|read|notSent|invalid
  smsStatus: "pending",   // SMS.pending|sent|delivered|failed
  cardUrl: "https://...", // uploaded card image
  uploadStatus: "uploaded", // idle|uploading|uploaded|failed
  resetAt: null,          // status_reset_at timestamp

  // Extra spreadsheet columns become {placeholder} values for SMS templates
  "Guest Title": "Mheshimiwa",

  // Flags
  sample: false,          // true = placeholder row, never saved
}
```

---

## 7. SMS Template Syntax

```
Habari {name}, kadi yako ya {cardType} iko tayari.
Tafadhali uwasiliane nasi kwa maswali: {phone}
Mwaliko: {CustomColumn}
```

- `{name}` → `rec.name`
- `{cardType}` → `rec.cardType`
- `{phone}` → `rec.phone` (formatted)
- `{AnyOtherColumnHeader}` → `rec["AnyOtherColumnHeader"]`

Implemented in `fillTemplate()` in `supabase/functions/_shared/messaging.js`.

---

## 8. The Guest Link URL Structure

```
https://yourdomain.com/#/g/<eventPublicId>/<guestPublicId>

Where:
  eventPublicId = events.public_id (8 chars, A-Z 2-9)
  guestPublicId = event_cards.public_id (8 chars, A-Z 2-9)

Example:
  https://nikadistudio.com/#/g/HN3K5P9A/JM2T8XNQ
```

The link is added to every SMS automatically when `events.guest_link_enabled = TRUE`.

---

## 9. Card Code Format

```
Examples: "7B42", "A395", "9K01", "23H7"

Rules:
- Exactly 4 characters
- 3 digits (0-9)
- 1 uppercase letter from: ABCDEFGHJKMNPQRSTUVWXYZ (no I, O, L — easily confused)
- Letter position is random (can be in any of the 4 positions)
- Generated by gen_card_code() SQL function
- Assigned on INSERT by trigger, backfilled for existing rows
```

---

## 10. Before Every Commit Checklist

```bash
npm run lint             # zero errors
npm test                 # all pass
npm run build            # builds without errors
# If Edge Functions were touched:
npm run test:functions
# Then manually test the changed feature in:
npm run dev
```

---

## 11. Git Branching

| Branch | Purpose |
|--------|---------|
| `main` | Production — auto-deploys to Heroku via CI |
| `dev` | Active development; merge to main when ready |

Feature work happens on `dev`. When stable, merge to `main`.

Commit message format:
```
Short imperative description

Longer explanation if needed. Bullet points for multiple changes:
- Added X
- Fixed Y
- Removed Z

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

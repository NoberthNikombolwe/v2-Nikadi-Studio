# Nikadi Studio — Authentication & Security

**Last updated:** 2026-11-16

---

## 1. Authentication

### 1.1 Provider

Supabase Auth (email/password). The app does not use OAuth or social login.

### 1.2 Invite-Only Access

Sign-up is disabled. Only invited users (rows in `app_users`) can sign in.

**Mechanism:**
1. Admin invites a user via Settings → Users (inserts into `app_users`)
2. Supabase sends a one-time invite link to the email address
3. User sets a password via the link
4. On every sign-in, a Supabase trigger checks that the email is in `app_users` with `active = TRUE`. If not, the trigger raises an exception and the sign-in fails.

```sql
-- Trigger that rejects unrecognised emails
CREATE OR REPLACE FUNCTION public.trg_fn_check_app_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_users WHERE email = lower(NEW.email) AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  RETURN NEW;
END;
$$;
```

### 1.3 Session Management

- Supabase manages JWT tokens and refresh cycles automatically
- The app reads the session via `supabase.auth.getSession()` and `supabase.auth.onAuthStateChange()`
- The JWT is used as the Bearer token for all authenticated API calls
- In production, the JWT is passed to Edge Functions, which use it to verify identity before injecting provider secrets

### 1.4 Role Resolution

```js
// In <App> after sign-in
const { data: userRow } = await supabase
  .from("app_users")
  .select("role,full_name,active")
  .eq("email", user.email.toLowerCase())
  .single();

// role is then used for all permission checks
const isSuperAdmin = role === "superuser";
const canDelete    = isSuperAdmin;  // only Super Admins can delete
```

---

## 2. Row Level Security (RLS)

### 2.1 Principle

**The anon key ships in the browser bundle and is therefore public.** Any policy granted to the `anon` role is effectively public data. No application data table should ever have an `anon` policy.

Rule: **`anon` gets zero direct table access — no exceptions.**

### 2.2 Policy Structure

All application tables follow the same pattern:

```sql
-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to do everything (no per-user row ownership yet)
CREATE POLICY "authenticated_all_events" ON events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Restrict DELETE to superuser only (RESTRICTIVE = all policies must pass)
CREATE POLICY "p_events_delete_super_admin" ON events
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (has_perm('events', FALSE) AND is_active_user());
```

### 2.3 `is_active_user()` Function

Checks that the calling user is in `app_users` with `active = TRUE`:

```sql
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE email = lower((auth.jwt() ->> 'email')) AND active = TRUE
  );
$$;
```

### 2.4 `has_perm(module, edit)` Function

Checks the calling user's role has the required permission for a module:

```sql
CREATE OR REPLACE FUNCTION public.has_perm(p_module TEXT, p_edit BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users u
    JOIN public.role_permissions p ON p.role = u.role
    WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
      AND u.active = TRUE
      AND p.module = p_module
      AND (NOT p_edit OR p.can_edit = TRUE)
      AND p.can_view = TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
      AND u.role = 'superuser' AND u.active = TRUE
  );
$$;
```

### 2.5 Append-Only Audit Log

`event_logs` has no UPDATE or DELETE policies. Only INSERT and SELECT. `user_email` is set by the database from the JWT (`auth.jwt() ->> 'email'`), so it cannot be spoofed from the browser:

```sql
CREATE POLICY "authenticated_insert_event_logs" ON event_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_email IS NOT DISTINCT FROM (auth.jwt() ->> 'email'));
```

---

## 3. Public Pages Security

### 3.1 SECURITY DEFINER RPCs

Public pages (scanner, guest microsite, view-only report) use `SECURITY DEFINER` RPCs:

```sql
CREATE OR REPLACE FUNCTION public.public_event_page_data(...)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
...
$$;
REVOKE ALL ON FUNCTION public.public_event_page_data(TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.public_event_page_data(TEXT, TEXT) TO anon, authenticated;
```

**What this means:**
- The function runs with the privileges of the defining user (service role)
- It can read tables that have no anon policies
- But it only returns the specific fields the developer chose to expose
- Phone numbers, emails, internal IDs are never returned

### 3.2 Code-Protected Public Pages

The scanner page and view-only page require a one-time code stored in the event:
- `events.scan_code` — required to use the scanner
- `events.view_code` — required to use the view-only report

These codes are generated in the app and given to door staff / clients. If the code is not known, the page shows no data.

### 3.3 Guest Link Security

Guest invitation links are:
- Only generated when `events.guest_link_enabled = TRUE`
- Behind the `public_event_page_data()` RPC which checks the flag
- 8-char public IDs — not guessable (charset: 32 chars → 32^8 = ~1 trillion combinations)

---

## 4. Provider Secret Management

### 4.1 Development

Provider tokens are in `.env.development.local` (git-ignored):
```
VITE_SMS_BEARER_TOKEN=...
VITE_WA_BEARER_TOKEN=...
```

The Vite proxy forwards them to the provider. They are never bundled into the app.

### 4.2 Production

Provider tokens are in Supabase Vault:
```sql
SELECT vault.create_secret('your_sms_token', 'nikadi_sms_token');
SELECT vault.create_secret('your_wa_token',  'nikadi_wa_token');
```

The Edge Functions (`send-sms`, `send-wa`) read them from Vault at request time and inject them into the provider request. The browser only ever sends its Supabase JWT — not the provider token.

---

## 5. UI Security

### 5.1 Delete Button Gating

Every delete action is gated on the `canDelete` context value (only `true` for Super Admins):

```jsx
const canDelete = useContext(CanDeleteContext);

{canDelete && (
  <Sb bg={N.redBg} col={N.red} onClick={() => deleteEvent(ev)}>
    <Icon n="trash" /> Delete
  </Sb>
)}
```

The database enforces this via RESTRICTIVE policies independently of the UI — hiding the button is UX, the SQL policy is the real gate.

### 5.2 Role-Based Tab Visibility

```js
const canSeeTab = (tabKey) => {
  if (!role) return false;
  const module = TAB_MODULE[tabKey];
  if (module === null) return true;   // Guide is always visible
  return can(permMatrix, role, module, "view");
};
```

Tabs are hidden for roles without access, not just disabled.

### 5.3 Input Sanitisation

- Phone numbers are normalised via `normalisePhone()` before storage
- SMS templates: `{placeholders}` are user-provided values escaped within the template string (no HTML rendering)
- Card images are JPEG/PNG blobs rendered on a canvas — not injected into the DOM as HTML
- All Supabase queries use parameterised queries (the Supabase JS client handles this)

---

## 6. Security Audit Checklist

Before deploying a new feature, verify:

- [ ] No new `anon` table policies added
- [ ] New tables have RLS enabled
- [ ] New tables have `REVOKE ALL FROM anon` + explicit `GRANT` to `authenticated`
- [ ] New public RPCs are `SECURITY DEFINER SET search_path = public`
- [ ] New public RPCs have `REVOKE ALL FROM public` then explicit `GRANT`
- [ ] New public RPCs expose minimum fields (no phone, email, internal UUID)
- [ ] Delete buttons wrapped in `{canDelete && (...)}`
- [ ] No secrets in browser-bundled code
- [ ] New storage buckets set appropriately (public only for wa-cards and event-pages)
- [ ] User-supplied text is not rendered as HTML (no `dangerouslySetInnerHTML`)
- [ ] Provider API calls go through the proxy (not directly from browser)

---

## 7. Known Security Boundaries

| Boundary | Mechanism |
|----------|-----------|
| Unauthenticated users | Supabase Auth blocks access; RLS has no anon policies |
| Inactive/uninvited users | `is_active_user()` RESTRICTIVE policy + auth trigger |
| Cross-role data isolation | No per-user row ownership; all roles see all events (by design — small team) |
| Data deletion | Only `superuser` role, enforced at both DB (RESTRICTIVE) and UI levels |
| Provider keys | Never in browser bundle; injected server-side by Edge Functions |
| Public page data exposure | Only via SECURITY DEFINER RPCs with minimal field exposure |
| Guest link enumeration | 8-char IDs from 32-char charset = ~1 trillion combinations |

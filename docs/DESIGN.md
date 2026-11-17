# Nikadi Studio — Design System

**Last updated:** 2026-11-16

---

## 1. Design Philosophy

Nikadi Studio is an internal operations tool. The design is:
- **Dark-first** — the team uses it for hours; dark backgrounds reduce eye strain
- **Information-dense** — tables, stats and forms are preferred over carousels and animations
- **Role-safe** — UI elements that a role cannot use are hidden, not disabled
- **Mobile-aware** — tables collapse on narrow screens; core actions remain tappable

---

## 2. Colour Tokens

All colours are CSS variables defined in `src/index.css` and accessed as `N.*` from `src/lib/theme.js`.

```js
import { N, alpha } from "./lib/theme";
// N.sky  → "var(--nk-sky)"
// alpha(N.sky, "44")  → "color-mix(in srgb, var(--nk-sky) 26%, transparent)"
```

### 2.1 Available Tokens

| Token | Light theme | Dark theme | Use |
|-------|-------------|------------|-----|
| `N.navy900` | `#f0f4f8` | `#0a0f1e` | Page background |
| `N.navy800` | `#dce4ef` | `#111827` | Card/panel background |
| `N.navy700` | `#c5d2e3` | `#1a2435` | Elevated surface |
| `N.navy600` | `#b0bed3` | `#1e2d44` | Button background |
| `N.navy500` | `#8fa0ba` | `#2a3d57` | Muted surface |
| `N.sky` | `#0284c7` | `#38bdf8` | Primary interactive |
| `N.accent` | `#7c3aed` | `#a78bfa` | Brand accent / CTA |
| `N.accentHover` | `#6d28d9` | `#c4b5fd` | Hover state |
| `N.gold` | `#b45309` | `#fbbf24` | Premium / highlight |
| `N.green` | `#059669` | `#34d399` | Success / coming |
| `N.red` | `#dc2626` | `#f87171` | Danger / not coming |
| `N.amber` | `#d97706` | `#fbbf24` | Warning / busy |
| `N.purple` | `#7c3aed` | `#a78bfa` | Secondary accent |
| `N.teal` | `#0891b2` | `#22d3ee` | Links / tertiary |
| `N.text` | `#1e293b` | `#f1f5f9` | Body text |
| `N.textMid` | `#475569` | `#94a3b8` | Secondary text |
| `N.textDim` | `#94a3b8` | `#475569` | Placeholder / labels |
| `N.border` | `#cbd5e1` | `#1e3a5f` | Borders |
| `N.cardBg` | `#ffffff` | `#111827` | Card background |

### 2.2 Alpha Usage

```js
// CORRECT
alpha(N.sky, "44")        // 26% opacity
alpha(N.accent, "1a")     // 10% opacity
alpha(N.red, 0.5)         // 50% opacity (also accepts 0–1 float)

// WRONG — do not append hex alpha directly to N.* tokens
`${N.sky}44`              // This does NOT work on CSS variables
```

---

## 3. Typography

**Font family:** `Plus Jakarta Sans` (Google Fonts, loaded at app start)  
**Mono font:** `JetBrains Mono` (used for codes, phone numbers, card codes)

| Use | Size | Weight |
|-----|------|--------|
| Page title | 20px | 800 |
| Section heading | 16–18px | 700–800 |
| Body | 13–14px | 400 |
| Label | 12px | 500 |
| Monospace data | 12px | 400 |
| Table cell | 13px | 400 |
| Stat number | 18–24px | 700–800 |

---

## 4. Icons

All icons are inline SVGs from `src/Icon.jsx`. Never use emoji.

```jsx
import Icon from "./Icon";

<Icon n="save" />               // 1.1em default
<Icon n="loader" />             // spins via .nk-spin CSS class
<Icon n="check" size="0.9em" />
<Icon n="alert" style={{ color: N.red }} />
```

### Available Icons

`loader`, `check`, `checks`, `x`, `xCircle`, `alert`, `info`, `circle`, `dot`, `whatsapp`, `sms`, `send`, `download`, `upload`, `cloud`, `save`, `arrowUp`, `arrowDown`, `refresh`, `undo`, `trash`, `edit`, `history`, `contact`, `plus`, `wallet`, `user`, `users`, `folder`, `calendar`, `target`, `palette`, `report`, `image`, `bank`, `table`, `chart`, `repeat`, `file`, `phone`, `monitor`, `sun`, `moon`, `database`, `book`, `search`, `eye`, `ruler`, `ban`, `plug`, `battery`, `mic`, `alignLeft`, `alignCenter`, `alignRight`, `handshake`, `note`, `smartphone`, `cash`, `briefcase`, `link`, `inbox`, `help`, `map`, `arrowRight`, `camera`, `scan`, `shield`, `settings`, `minus`, `copy`, `lock`, `chevronDown`, `menu`, `trendUp`, `clock`, `pause`, `play`, `message`, `star`, `sparkles`, `bulb`

---

## 5. Component Patterns

### 5.1 Buttons

```jsx
// Primary button
<button className="nk-btn nk-btn-primary" onClick={save}>
  <Icon n="save" /> Save
</button>

// Ghost button
<button className="nk-btn nk-btn-ghost" onClick={cancel}>
  Cancel
</button>

// Small action button (Sb)
<Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")} onClick={...}>
  <Icon n="edit" /> Edit
</Sb>
```

### 5.2 Modals

**Rule:** Modals close ONLY via the ✕ button or Cancel button. No backdrop click, no Escape key.

```jsx
<div className="nk-overlay" role="dialog" aria-modal="true">
  <div className="nk-modal" style={{ maxWidth: 560 }}>
    <div className="nk-modal-head">
      <div className="nk-modal-title">Title</div>
      <button className="nk-modal-close" onClick={onClose}>
        <Icon n="x" />
      </button>
    </div>
    <div className="nk-modal-body">
      {/* content */}
    </div>
    <div className="nk-modal-foot">
      <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
      <button className="nk-btn nk-btn-primary" onClick={save}>Save</button>
    </div>
  </div>
</div>
```

### 5.3 Form Inputs

```jsx
<label className="nk-label">Field Name</label>
<input className="nk-input" placeholder="…" value={form.field} onChange={e => setForm(f => ({...f, field: e.target.value}))} />
```

### 5.4 Toggle

```jsx
<Toggle
  checked={!!form.enabled}
  onChange={v => setForm(f => ({ ...f, enabled: v }))}
  label="Enable this feature"
/>
```

### 5.5 Stats Row

```jsx
<div className="nk-stats">
  <div className="nk-stat">
    <div className="nk-stat-num" style={{ color: N.green }}>42</div>
    <div className="nk-stat-label">Coming</div>
  </div>
</div>
```

### 5.6 Tables

```jsx
<div className="nk-table-wrap">
  <table className="nk-table m-hide-5">
    <thead><tr><th>Column</th></tr></thead>
    <tbody>
      {rows.map(r => <tr key={r.id}><td>{r.name}</td></tr>)}
    </tbody>
  </table>
</div>
```

`m-hide-5` hides the 5th column on mobile. `m-hide` on a `<td>` hides it on mobile.

---

## 6. Toast Notifications

```js
showToast("Card saved", "success");
showToast("Could not save: " + error.message, "warn");
showToast("Sending…", "info");
```

Tones: `"success"` (green), `"warn"` (amber), `"info"` (sky)

---

## 7. Colour Usage for Status

| Status | Colour Token |
|--------|-------------|
| Success / coming / sent | `N.green` |
| Error / not coming / failed | `N.red` |
| Warning / busy | `N.amber` |
| Info / in-progress | `N.sky` |
| Delete button | `N.red` with `N.redBg` background |

---

## 8. Public Microsite Design

The public guest page (`PublicGuestPage.jsx`) uses dynamic CSS variables from `event_pages.page_settings`:

| Setting | Default |
|---------|---------|
| `bg_color` | `#0A0F1E` |
| `primary_color` | `#00C2FF` |
| `accent_color` | `#7C3AED` |
| `text_color` | `#FFFFFF` |

Design principles for the microsite:
- Full-screen hero image with gradient overlay
- Section dividers: thin horizontal lines with uppercase centred label
- Countdown timer uses tabular-nums for stable layout
- Typography: `clamp(28px, 7vw, 52px)` for headings (responsive without media queries)
- Swahili section titles: Ratiba ya Siku, Mahali pa Sherehe, Wahusika Wakuu, etc.

---

## 9. Responsive Breakpoints

```css
/* From src/index.css */
@media (max-width: 760px)  { /* mobile */  }
@media (max-width: 900px)  { /* tablet */  }
@media (min-width: 1200px) { /* desktop wide */ }
```

The `className="m-hide"` utility hides elements on mobile. The scanner and calls views have dedicated mobile layouts.

---

## 10. Dark / Light Theme

```js
import { getThemePref, applyTheme, nextThemePref } from "./lib/theme";

applyTheme("dark");    // sets data-theme="dark" on <html>
applyTheme("light");   // sets data-theme="light"
applyTheme("system");  // removes data-theme, follows prefers-color-scheme
```

The theme is applied before the first React render (in `main.jsx`) to prevent flashing.

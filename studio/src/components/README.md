# src/components — Shared UI Primitives (View layer)

Each file is one reusable UI component used across multiple modules.
These are small, presentation-only components with no business logic.

| File | Export | Purpose |
|------|--------|---------|
| Toggle.jsx | `Toggle` | Labelled checkbox toggle |
| Sb.jsx | `Sb` | Compact icon-style action button for table rows |
| EmptyState.jsx | `EmptyState`, `TONE`, `TONE_BG` | Full-panel empty / loading / error placeholder |
| Pill.jsx | `Pill` | Small coloured status label |

## Adding a new component

1. Create `MyComponent.jsx` in this folder.
2. Import only from `../lib/*`, `../Icon`, `../Logo`, or npm packages.
3. Export the component as a named export.
4. Add it to `index.js`.

## Rules
- No data fetching (no supabase calls) — that belongs in `../hooks/`
- No business logic — that belongs in `../lib/`
- No emoji — use `<Icon n="name" />` from `../Icon`
- Modals close only via their ✕/Cancel button, never on backdrop click or Esc

# src/hooks — Custom React Hooks (Controller layer)

Each file is one custom hook. Hooks handle data fetching, Supabase realtime, and side-effects.
They contain no JSX and no UI rendering.

| File | Hook | Purpose |
|------|------|---------|
| useAutoClearLog.js | `useAutoClearLog` | Clears an activity log after 5 s once all tasks finish |
| useEventCards.js | `useEventCards` | Loads event_cards for the open event; realtime updates |
| useDeliveries.js | `useDeliveries` | Loads message_deliveries; realtime updates; notifies on each new row |
| useSchedules.js | `useSchedules` | Loads message_schedules + runs for one event+channel; realtime |
| useScheduleActions.js | `useScheduleActions` | Pause / resume / cancel / delete a schedule via Supabase RPC |
| useServerClock.js | `useServerClock` | Measures server time offset once; shared across all schedule pop-ups |
| useStorageUsage.js | `useStorageUsage` | Calls storage_usage RPC; returns used/total/left/pct per bucket |

## Adding a new hook

1. Create `useMyHook.js` in this folder.
2. Import only from `../lib/*`, `../hooks/*`, or npm packages — never from `../components` or `../modules`.
3. Export the hook as a named export.
4. Add it to `index.js`.

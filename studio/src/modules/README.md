# src/modules — Feature Modules (View + Controller layer)

Each subdirectory is one application feature/tab. Each module owns its own UI components,
local state, and tab-level logic. This is the production team's primary working area.

## Directory Map

| Folder | Tab(s) | Contents |
|--------|--------|---------|
| events/ | Events tab | Event list, EventModal, EventOverview |
| design/ | Design tab | Card canvas, element editor, template picker |
| sms/ | SMS tab | SMS send panel, SMS preview, bulk send |
| whatsapp/ | WhatsApp tab | WA send panel, WA preview, bulk send |
| calls/ | Calls tab | Call status tracking per guest |
| scanner/ | Scanner tab | QR scanner, check-in, guest list |
| reports/ | Reports tab | Delivery reports, failure reasons |
| schedules/ | Schedules tab | All-event schedule list and management |
| settings/ | Settings tab | Roles, templates, sender IDs, storage |
| finance/ | Finance tab | Transactions, accounts, P&L |
| crm/ | Leads + Customers tabs | Lead pipeline, customer management |
| feedback/ | Feedback tab | User feedback review and replies |
| guide/ | Guide tab | Onboarding guide steps and progress |
| calls/ | Calls tab | Per-guest call log and status |

## Status

The modules directory structure is set up and ready. As App.jsx is split further, each
tab's components will be extracted here. Currently App.jsx still contains the tab JSX —
this is the planned next step for the production team.

## Adding code to a module

1. Create `index.jsx` (the main tab component) and additional files as needed.
2. Import hooks from `../../hooks/`.
3. Import shared UI from `../../components/`.
4. Import pure logic from `../../lib/`.
5. The module's main export is its tab component (e.g. `export default SmsTab`).

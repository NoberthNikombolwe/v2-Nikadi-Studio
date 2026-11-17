# Nikadi Studio

**An internal event card design and distribution tool for Tanzanian event companies.**

Nikadi Studio covers the full lifecycle of an event invitation:  
Lead → Customer → Event → Design → Guest Import → WhatsApp/SMS → Door Check-in → Finance

---

## What it does

| Feature | Description |
|---------|-------------|
| **CRM** | Capture leads, log follow-ups, qualify to customers and events |
| **Card Designer** | Drag-and-drop canvas: name, QR code, date, logo on a background image |
| **Guest Import** | Import guest lists from Excel/CSV; merge without resending |
| **WhatsApp** | Send personalised card images per guest; delivery tracking |
| **SMS** | Personalised templated SMS with `{name}` placeholders; scheduled sends |
| **Guest Microsites** | Personal invitation page per guest: hero, countdown, card download, map, RSVP |
| **Scanner** | QR-code door check-in with real-time feed across devices |
| **Call Tracker** | Record guest confirmation calls: coming / not coming / busy |
| **Finance** | Per-event income and expenses; P&L summary |
| **Schedules** | Send SMS or WhatsApp at a chosen future time (pg_cron powered) |

---

## Tech stack

- **Frontend:** React 19 + Vite 8, deployed to Heroku
- **Backend:** Supabase (Postgres + Auth + Storage + Real-time + Edge Functions)
- **Messaging:** messaging-service.co.tz (SMS + WhatsApp)
- **AI:** Gemini (data cleaning chat)

---

## Quick start

```bash
# Prerequisites: Node 22+, a Supabase project, a messaging-service.co.tz account

git clone https://github.com/<org>/v1-Nikadi-Studio.git
cd v1-Nikadi-Studio/studio

npm install

# Configure environment
cp .env.example .env.development.local
# Edit .env.development.local — see docs/SETUP.md

# Run the database schema
# In Supabase SQL Editor → New Query, paste studio/supabase-schema.sql and run

# Start the dev server
npm run dev
# → http://localhost:5173
```

Full setup walkthrough: [docs/SETUP.md](SETUP.md)

---

## Repository layout

```
v1-Nikadi-Studio/
├── studio/               ← All application code (run commands from here)
│   ├── src/
│   │   ├── App.jsx       ← Single-file UI (~3 000 lines)
│   │   ├── main.jsx      ← Entry point + hash routing
│   │   ├── lib/          ← Pure logic modules (unit-tested)
│   │   ├── LoginPage.jsx
│   │   ├── PublicGuestPage.jsx
│   │   ├── PublicScanPage.jsx
│   │   ├── PublicViewPage.jsx
│   │   └── Icon.jsx      ← Inline SVG icon set
│   ├── supabase-schema.sql
│   ├── supabase-roles-settings-scan.sql
│   ├── vite.config.js
│   └── package.json
├── supabase/
│   └── functions/        ← Edge Functions (send-sms, send-wa, run-schedules, ai-clean)
├── docs/                 ← This documentation
├── server.js             ← Heroku static file server
├── Procfile              ← Heroku process definition
└── package.json          ← Heroku build root
```

---

## Documentation

| Document | Contents |
|----------|---------|
| [PRD.md](PRD.md) | Product requirements, users, feature list |
| [DESIGN.md](DESIGN.md) | Design system, colour tokens, component patterns |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, tech stack decisions |
| [DATABASE.md](DATABASE.md) | Full schema reference, table columns, RPCs |
| [API.md](API.md) | Supabase, messaging provider and Edge Function API reference |
| [AGENTS.md](AGENTS.md) | AI agent (data clean chat) design |
| [SETUP.md](SETUP.md) | Installation, environment, first run |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Development conventions and patterns |
| [FEATURES.md](FEATURES.md) | Feature development guide (how to add new features) |
| [AUTH_SECURITY.md](AUTH_SECURITY.md) | Authentication, RLS, role-based access |
| [MCP.md](MCP.md) | MCP server connections for Claude Code |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Third-party integration details |
| [TESTING.md](TESTING.md) | Testing strategy, unit tests, red team, QA |
| [DEBUGGING.md](DEBUGGING.md) | Common issues, debug techniques, tools |

---

## Commands

```bash
npm run dev              # Vite dev server on :5173
npm run build            # Production build → dist/
npm run lint             # ESLint
npm test                 # Unit tests (src/lib/)
npm run test:functions   # Edge Function tests
npm run preview          # Serve production build locally
```

---

## Deployment

Deploys automatically to Heroku when a commit is pushed to `main` and GitHub Actions CI passes.

Manual deploy:
```bash
git push heroku main
```

See [docs/SETUP.md](SETUP.md#deploy-to-heroku) for the full Heroku setup.

---

## Roles

| Role | Key | Access |
|------|-----|--------|
| Super Admin | `superuser` | Everything, including deletes |
| Admin | `admin` | Full day-to-day management |
| Sales Officer | `sales_officer` | Leads, customers, events, SMS |
| Graphics Designer | `graphics_designer` | Design, WhatsApp, VCard |
| Help Desk | `help_desk` | Scanner, calls, SMS |
| Tele Sales | `telesales` | Calls, leads, SMS |
| Finance Officer | `finance_officer` | Finance module only |

New staff members are invited by email in Settings → Users. Sign-in is invite-only.

---

## Contributing

1. Work on the `dev` branch
2. Run `npm run lint && npm test && npm run build` before every commit
3. All UI changes require a manual check in `npm run dev`
4. See [docs/IMPLEMENTATION.md](IMPLEMENTATION.md) for coding conventions
